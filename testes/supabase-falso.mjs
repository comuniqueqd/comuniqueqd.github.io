// Servidor de teste que imita o pedaço da API do Supabase que o app usa:
//   POST /rest/v1/rpc/<função>   → chama public.<função>(args) no Postgres, como PostgREST faz
//                                   (papel "authenticated" + claims do JWT em request.jwt.claims)
//   POST /auth/v1/token?grant_type=id_token → login com o token do botão do Google (confere o nonce)
//   GET  /auth/v1/user, POST /auth/v1/logout
// O JWT não é verificado (é só teste). Realtime não existe aqui: o app cai no recarregamento periódico.
import http from "node:http";
import pg from "pg";
import { createHash } from "node:crypto";

// lista de objetos (jsonb) vai como JSON; listas simples (text[]/uuid[]) ficam como array do Postgres
const jsonDeObjetos = (v) => (Array.isArray(v) && v.some((x) => x && typeof x === "object")) || (v && typeof v === "object" && !Array.isArray(v)) ? JSON.stringify(v) : v;
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
    let corpo = "";
    for await (const parte of req) corpo += parte;
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") {
      const b = JSON.parse(corpo || "{}");
      let g;
      try { g = JSON.parse(Buffer.from(String(b.id_token).split(".")[1], "base64url").toString()); }
      catch (_) { return responder(res, 400, { code: 400, error_code: "bad_jwt", msg: "token inválido" }); }
      if (g.nonce !== createHash("sha256").update(b.nonce || "").digest("hex")) return responder(res, 400, { code: 400, error_code: "bad_jwt", msg: "Nonces mismatch" });
      const h = createHash("sha1").update(g.email).digest("hex");
      const sub = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const meta = { full_name: g.name, email: g.email };
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const access = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub, email: g.email, role: "authenticated", aud: "authenticated", exp, user_metadata: meta })}.x`;
      return responder(res, 200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r",
        user: { id: sub, email: g.email, aud: "authenticated", role: "authenticated", user_metadata: meta, app_metadata: { provider: "google" } } });
    }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m || req.method !== "POST") return responder(res, 404, { message: "não implementado no servidor de teste" });
    const args = corpo ? JSON.parse(corpo) : {};
    const nomes = Object.keys(args).filter((k) => /^p_[a-z0-9_]+$/.test(k));
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query(`set local role ${claims ? "authenticated" : "anon"}`);
      await cli.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: "anon" })]);
      const { rows } = await cli.query(`select public.${m[1]}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, nomes.map((n) => jsonDeObjetos(args[n])));
      await cli.query("commit");
      responder(res, 200, rows[0].r ?? null);
    } catch (e) {
      await cli.query("rollback").catch(() => {});
      responder(res, e.code === "42501" ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null });
    } finally { cli.release(); }
  });
  return new Promise((ok) => server.listen(porta, "127.0.0.1", () => ok({ fechar: async () => { server.close(); await pool.end(); } })));
}
