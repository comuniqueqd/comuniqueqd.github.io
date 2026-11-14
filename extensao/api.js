// Conversa com o banco do Comunique (Supabase) com o mesmo login Google do site.
// Usado pelo service worker (importScripts) e pelo painel lateral (<script>). Sem bibliotecas.
// A sessão fica em chrome.storage.local (o service worker dorme e acorda: nada em variáveis).
(() => {
  const C = globalThis.COMUNIQUE;
  const H = { apikey: C.SUPABASE_KEY, "Content-Type": "application/json" };

  async function sessao() {
    const { sessao } = await chrome.storage.local.get("sessao");
    return sessao || null;
  }
  async function guardar(dados) {
    const s = { access_token: dados.access_token, refresh_token: dados.refresh_token,
      expira: Date.now() + (Number(dados.expires_in) || 3600) * 1000, email: dados.user?.email || dados.email || null };
    await chrome.storage.local.set({ sessao: s });
    return s;
  }

  // Login: abre a janela do Google pelo Supabase e volta para https://<id-da-extensão>.chromiumapp.org/
  async function entrar() {
    const volta = chrome.identity.getRedirectURL();
    const url = `${C.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(volta)}`;
    const resp = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    const p = new URLSearchParams(new URL(resp).hash.slice(1));
    if (p.get("error")) throw new Error(p.get("error_description") || p.get("error"));
    if (!p.get("access_token")) throw new Error("O login não voltou com a sessão. Tente de novo.");
    const s = await guardar({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: p.get("expires_in") });
    await rpc("entrar").catch(() => {});
    return s;
  }
  async function sair() {
    const s = await sessao();
    await chrome.storage.local.remove(["sessao", "vistos"]);
    if (s) fetch(`${C.SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { ...H, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  }

  async function renovar(s) {
    const r = await fetch(`${C.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", headers: H, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (!r.ok) { await chrome.storage.local.remove("sessao"); const e = new Error("Entre de novo no Comunique."); e.semSessao = true; throw e; }
    return guardar(await r.json());
  }
  async function token() {
    let s = await sessao();
    if (!s) { const e = new Error("Entre com o Google para usar a extensão."); e.semSessao = true; throw e; }
    if (s.expira - Date.now() < 60000) s = await renovar(s);
    return s;
  }

  async function rpc(fn, args = {}) {
    let s = await token();
    const chamar = (t) => fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { ...H, Authorization: `Bearer ${t}` }, body: JSON.stringify(args) });
    let r = await chamar(s.access_token);
    if (r.status === 401) { s = await renovar(s); r = await chamar(s.access_token); }
    const txt = await r.text();
    const dados = txt ? JSON.parse(txt) : null;
    if (!r.ok) throw new Error(dados?.message || `Erro ${r.status} ao falar com o Comunique.`);
    return dados;
  }

  globalThis.ComuniqueApi = { sessao, entrar, sair, rpc };
})();
