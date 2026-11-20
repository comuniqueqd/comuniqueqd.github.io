// "bloqueio" se chama "restrição" no que a equipe lê (mesmas regras de js/base.js e de public.texto_restricao)
const REGRAS_RESTRICAO = [["este bloqueio não está ativo", "esta restrição não está ativa"], ["bloqueio não está ativo", "restrição não está ativa"], ["bloqueio não encontrado", "restrição não encontrada"], ["nenhum bloqueio", "nenhuma restrição"], ["todos os bloqueios", "todas as restrições"], ["quantos bloqueios", "quantas restrições"], ["próximos bloqueios", "próximas restrições"], ["bloqueio excluído", "restrição excluída"], ["bloqueio curto", "restrição curta"], ["bloqueio definitivo", "restrição definitiva"], ["bloqueios liberados", "restrições liberadas"], ["bloqueio normal gerado", "restrição normal gerada"], ["voltaram a ser bloqueados", "voltaram a receber restrição"], ["os bloqueados", "os entregadores com restrição"], ["seus bloqueados", "seus entregadores com restrição"], ["bloqueio temporário", "restrição temporária"], ["um bloqueio e o seguinte", "uma restrição e a seguinte"], ["bloqueio(s) já registrados", "restrição(ões) já registradas"], ["bloqueio(s)", "restrição(ões)"], ["bloqueado(s)", "com restrição"], ["Bloqueado(s)", "Com restrição"], ["novo bloqueio", "nova restrição"], ["um bloqueio", "uma restrição"], ["o bloqueio", "a restrição"], ["os bloqueios", "as restrições"], ["do bloqueio", "da restrição"], ["dos bloqueios", "das restrições"], ["no bloqueio", "na restrição"], ["nos bloqueios", "nas restrições"], ["ao bloqueio", "à restrição"], ["aos bloqueios", "às restrições"], ["pelo bloqueio", "pela restrição"], ["pelos bloqueios", "pelas restrições"], ["este bloqueio", "esta restrição"], ["esse bloqueio", "essa restrição"], ["deste bloqueio", "desta restrição"], ["desse bloqueio", "dessa restrição"], ["neste bloqueio", "nesta restrição"], ["seu bloqueio", "sua restrição"], ["seus bloqueios", "suas restrições"], ["outro bloqueio", "outra restrição"], ["mesmo bloqueio", "mesma restrição"], ["primeiro bloqueio", "primeira restrição"], ["último bloqueio", "última restrição"], ["1º bloqueio", "1ª restrição"], ["bloqueio gerado", "restrição gerada"], ["bloqueios gerados", "restrições geradas"], ["bloqueio registrado", "restrição registrada"], ["bloqueios registrados", "restrições registradas"], ["bloqueio ativo", "restrição ativa"], ["bloqueios ativos", "restrições ativas"], ["bloqueio novo", "restrição nova"], ["bloqueio corrigido", "restrição corrigida"], ["bloqueio normal", "restrição normal"], ["bloqueios normais", "restrições normais"], ["bloqueio apagado", "restrição apagada"], ["foi bloqueado", "recebeu restrição"], ["foram bloqueados", "receberam restrição"], ["já bloqueado", "já com restrição"], ["está bloqueado", "está com restrição"], ["estão bloqueados", "estão com restrição"], ["ficou bloqueado", "ficou com restrição"], ["bloqueados", "com restrição"], ["bloqueado", "com restrição"], ["bloqueadas", "com restrição"], ["bloqueada", "com restrição"], ["bloqueios", "restrições"], ["bloqueio", "restrição"], ["bloquear", "aplicar restrição"]];
const regrasRestricao = REGRAS_RESTRICAO.flatMap(([a, b]) => [[a, b], [a[0].toUpperCase() + a.slice(1), b[0].toUpperCase() + b.slice(1)]])
  .map(([a, b]) => [new RegExp(`(?<![\\p{L}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu"), b]);
const restricao = (t) => typeof t !== "string" || !/bloque/i.test(t) ? t : regrasRestricao.reduce((r, [re, b]) => r.replace(re, b), t);
// 009z (A12-04): erro técnico do servidor vira frase em português com o que fazer; a mensagem em português
// que o próprio banco escreve (raise exception) passa como está. MESMA função em js/base.js e extensao/api.js.
const ERROS_TECNICOS = [
  [/failed to fetch|networkerror|network request|load failed|fetch/i, "Não foi possível falar com o servidor. Confira a internet e tente de novo em instantes."],
  [/jwt|token.*(expired|invalid)|refresh token|sess(ion|ão) (expired|expirada)/i, "Sua sessão venceu. Saia e entre de novo."],
  [/pgrst202|schema cache|could not find the function/i, "O Comunique foi atualizado e o banco ainda não. Avise um moderador."],
  [/42501|permission denied|row-level security/i, "Seu acesso não permite esta ação."],
  [/23505|duplicate key|already exists/i, "Isso já foi registrado."],
  [/23502|not-null/i, "Falta preencher um campo obrigatório."],
  [/23503|foreign key/i, "Esse registro está ligado a outro e não pode ser mudado assim."],
  [/23514|check constraint|invalid input/i, "Algum dado não foi aceito. Confira os campos e tente de novo."],
  [/57014|timeout|canceling statement/i, "O servidor demorou para responder. Tente de novo."],
];
const PARECE_INGLES = /\b(the|of|is|not|does|violates|function|relation|column|could|failed|invalid|error|unexpected|null|undefined)\b/i;
function traduzirErro(msg, codigo) {
  const m = String(msg || "").trim(), tudo = `${codigo || ""} ${m}`;
  if (m && !PARECE_INGLES.test(m) && /[a-záéíóúãõâêôç]/i.test(m) && !/^[A-Z0-9]{5}$/.test(m)) return m;  // português do banco
  for (const [re, frase] of ERROS_TECNICOS) if (re.test(tudo)) return frase;
  if (m || codigo) console.warn("Erro do servidor:", codigo || "", m);
  return "Algo deu errado. Tente de novo; se repetir, avise um moderador.";
}
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
      method: "POST", headers: { ...H, Authorization: `Bearer ${t}` }, body: JSON.stringify(args) })
      .catch((x) => { throw new Error(traduzirErro(x?.message || "fetch")); });
    let r = await chamar(s.access_token);
    if (r.status === 401) { s = await renovar(s); r = await chamar(s.access_token); }
    const txt = await r.text();
    const dados = txt ? JSON.parse(txt) : null;
    if (!r.ok) throw new Error(restricao(traduzirErro(dados?.message || `Erro ${r.status}`, dados?.code)));
    return dados;
  }

  globalThis.ComuniqueApi = { sessao, entrar, sair, rpc };
})();
