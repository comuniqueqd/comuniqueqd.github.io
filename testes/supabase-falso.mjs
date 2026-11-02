// Servidor de teste que imita o pedaço da API do Supabase que o app usa:
//   POST /rest/v1/rpc/<função>   → chama public.<função>(args) no Postgres, como PostgREST faz
//                                   (papel "authenticated" + claims do JWT em request.jwt.claims)
//   GET  /auth/v1/user, POST /auth/v1/logout
// O JWT não é verificado (é só teste). Realtime não existe aqui: o app cai no recarregamento periódico.
import http from "node:http";
import pg from "pg";

export function iniciarSupabaseFalso({ porta = 54321, databaseUrl }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const claimsDe = (req) => {
    const tok = (req.headers.authorization || "").replace(/^Bearer /, "");
    try { const c = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()); return c.sub ? c : null; }
    catch (_) { return null; }
  };
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const responder = (res, status, corpo) => {
    res.writeHead(status, { ...cors, "Content-Type": "application/json" });
    res.end(corpo === undefined ? "" : JSON.stringify(corpo));
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, "http://x");
    const claims = claimsDe(req);
    if (url.pathname === "/auth/v1/user") return claims ? responder(res, 200, { id: claims.sub, email: claims.email, user_metadata: claims.user_metadata || {} }) : responder(res, 401, { message: "sem sessão" });
    if (url.pathname === "/auth/v1/logout") { res.writeHead(204, cors); return res.end(); }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m || req.method !== "POST") return responder(res, 404, { message: "não implementado no servidor de teste" });
    let corpo = "";
    for await (const parte of req) corpo += parte;
    const args = corpo ? JSON.parse(corpo) : {};
    const nomes = Object.keys(args).filter((k) => /^p_[a-z_]+$/.test(k));
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query(`set local role ${claims ? "authenticated" : "anon"}`);
      await cli.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: "anon" })]);
      const { rows } = await cli.query(`select public.${m[1]}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, nomes.map((n) => args[n]));
      await cli.query("commit");
      responder(res, 200, rows[0].r ?? null);
    } catch (e) {
      await cli.query("rollback").catch(() => {});
      responder(res, e.code === "42501" ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null });
    } finally { cli.release(); }
  });
  return new Promise((ok) => server.listen(porta, "127.0.0.1", () => ok({ fechar: async () => { server.close(); await pool.end(); } })));
}
