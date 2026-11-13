// Módulo "Registros": feed único das ações da equipe nos dois módulos (para todos os papéis;
// cada pessoa vê os módulos a que tem acesso). Vem de listar_registros() (supabase/004).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, fmtCPF, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const R = { itens: null, fim: false, mais: false, filtros: "", erro: null };
  const POR_PAGINA = 100;

  const filtros = () => ({ p_modulo: $("#rg-modulo").value || null, p_pessoa: $("#rg-pessoa").value || null, p_busca: $("#rg-q").value.trim() || null });
  const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: App.u.FUSO });
  const diaLongo = (iso) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: App.u.FUSO });

  async function buscar(anterior) {
    const f = filtros();
    const chave = JSON.stringify(f);
    const lote = await rpc("listar_registros", { ...f, p_antes: anterior || null, p_limite: POR_PAGINA });
    if (chave !== JSON.stringify(filtros())) return null;   // filtro mudou enquanto buscava
    return lote;
  }
  async function carregar() {
    // recarrega só a primeira página; se a pessoa já abriu mais, mantém o que já tinha além dela
    try {
      const lote = await buscar(null);
      if (!lote) return;
      const chave = JSON.stringify(filtros());
      if (R.itens && R.filtros === chave && R.itens.length > POR_PAGINA) {
        const ultimo = lote[lote.length - 1]?.em;
        R.itens = [...lote, ...R.itens.filter((x) => ultimo && x.em < ultimo)];
      } else { R.itens = lote; R.fim = lote.length < POR_PAGINA; }
      R.filtros = chave; R.erro = null;
    } catch (e) { R.erro = msgErro(e); }
  }
  async function carregarMais(btn) {
    btn.disabled = true; R.mais = true;
    try {
      const lote = await buscar(R.itens[R.itens.length - 1]?.em);
      if (lote) { R.itens = [...R.itens, ...lote]; R.fim = lote.length < POR_PAGINA; }
    } catch (e) { App.u.toast(msgErro(e)); }
    R.mais = false; App.render();
  }

  function preencherPessoas() {
    const sel = $("#rg-pessoa");
    const nomes = S.pessoas.map((p) => p.nome);
    const sig = nomes.join("|");
    if (sel.dataset.sig === sig) return;
    const cur = sel.value;
    sel.dataset.sig = sig;
    sel.replaceChildren(el("option", { value: "", text: "Qualquer pessoa" }), ...nomes.map((n) => el("option", { value: n, text: n })));
    sel.value = nomes.includes(cur) ? cur : "";
  }

  function entregador(x) {
    const partes = [];
    if (x.nome) partes.push(x.nome);
    if (x.id_app) partes.push("ID " + x.id_app);
    if (x.cpf) partes.push("CPF " + fmtCPF(x.cpf));
    if (x.cidade) partes.push(x.cidade);
    const txt = partes.join(" · ");
    if (x.id_app && S.me.papel_bloqueios && App.abrirFicha)
      return el("button", { class: "link-ficha", type: "button", title: "Consultar entregador", onclick: () => App.abrirFicha(x.id_app) }, txt);
    return txt;
  }

  function render() {
    preencherPessoas();
    $("#rg-modulo").hidden = !S.me.papel_bloqueios;
    const box = $("#rg-lista");
    if (R.erro && !R.itens) return box.replaceChildren(el("p", { class: "err", text: R.erro }));
    if (!R.itens || R.filtros !== JSON.stringify(filtros())) return box.replaceChildren(carregandoEl());
    if (!R.itens.length) return box.replaceChildren(vazio("Nenhum registro", "Nada com esses filtros."));
    const linhas = [];
    let diaAtual = null;
    for (const x of R.itens) {
      const d = App.u.diaChave(x.em);
      const li = el("li", {},
        d !== diaAtual ? el("div", { class: "dia", text: diaLongo(x.em) }) : null,
        el("span", { class: "quando" }, hora(x.em), el("br"), el("span", { class: "tag", text: x.modulo === "ativacao" ? "ATIVAÇÃO" : "BLOQUEIOS" })),
        el("div", {},
          el("div", {}, el("b", { text: x.por_nome || "—" }), " ", x.acao, " ", entregador(x)),
          x.detalhe ? el("div", { class: "det", text: x.detalhe }) : null));
      diaAtual = d;
      linhas.push(li);
    }
    box.replaceChildren(el("ul", { class: "feed" }, linhas),
      R.fim ? el("p", { class: "meta", style: "text-align:center", text: "Fim dos registros." })
        : el("div", { class: "actions", style: "justify-content:center;margin-top:12px" },
            el("button", { class: "btn", type: "button", disabled: R.mais, onclick: (e) => carregarMais(e.currentTarget) }, R.mais ? "Carregando…" : "Carregar mais")));
  }

  let tBusca = null;
  $("#rg-q").addEventListener("input", () => { clearTimeout(tBusca); tBusca = setTimeout(() => { render(); App.carregar(); }, 350); });
  ["#rg-modulo", "#rg-pessoa"].forEach((s) => $(s).addEventListener("change", () => { render(); App.carregar(); }));

  App.modulo({
    id: "registros", nome: "Registros",
    abas: [{ id: "feed", nome: "Registros", secao: "v-registros" }],
    carregar, render,
  });
})();
