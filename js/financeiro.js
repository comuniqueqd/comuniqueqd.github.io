// Módulo "Financeiro" (009b, prévia da 011): o que é pago ao entregador fora da corrida normal.
// - Registrar adicional (registrar_adicional): adicional = valor combinado (total) − valor da entrega.
// - Adicionais pendentes: o que EU registrei e ainda não foi lançado no sistema (adicionais e ajustes de bairro).
//   Qualquer pessoa pode marcar como lançado (marcar_lancado).
// - Lançamentos: lista com filtros + números (resumo_financeiro) e CSV.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, tabela, barras, baixarCSV } = App.u;
  const S = App.S;
  const G = { cidades: null, meus: null, pend: null, lista: null, resumo: null, erro: null, confirmar: {} };
  const brl = (v) => (v == null ? "—" : "R$ " + Number(v).toFixed(2).replace(".", ","));
  const valor = (s) => { const t = String(s || "").replace(/[^\d,.-]/g, ""); if (!t) return null; const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? n : NaN; };
  const TIPO = { adicional: "Adicional", ajuste_bairro: "Ajuste de bairro" };
  const ORIGEM = { qd: "QD", outros: "Outros" };

  // ---------- registrar adicional ----------
  const form = $("#fi-form"), erro = $("#fi-erro");
  const radio = (nome) => form.querySelector(`input[name="${nome}"]:checked`)?.value || null;
  $("#fi-id").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "")));
  form.addEventListener("input", () => { erro.hidden = true; renderPrevia(); });
  form.addEventListener("reset", () => { erro.hidden = true; setTimeout(() => { renderPrevia(); $("#fi-id").focus(); }); });
  // adicional rápido: combinado = entrega + x
  $("#fi-rapidos").replaceChildren(el("span", { class: "meta", text: "Adicional rápido:" }), ...[2, 3, 5, 10].map((x) =>
    el("button", { class: "chip", type: "button", onclick: () => {
      const e = valor($("#fi-entrega").value);
      if (e == null || Number.isNaN(e)) { $("#fi-entrega").focus(); return toast("Preencha primeiro o valor da entrega."); }
      $("#fi-combinado").value = (e + x).toFixed(2).replace(".", ","); renderPrevia();
    } }, `+ R$ ${x}`)));
  function renderPrevia() {
    const e = valor($("#fi-entrega").value), p = valor($("#fi-valor-pedido").value), c = valor($("#fi-combinado").value);
    const box = $("#fi-previa");
    if (e == null || c == null || Number.isNaN(e) || Number.isNaN(c)) return box.replaceChildren();
    const ad = Math.round((c - e) * 100) / 100;
    box.replaceChildren(el("div", { class: "fe-total" + (ad <= 0 ? " negativo" : "") },
      el("span", { text: "Adicional para o entregador" }), el("strong", { text: brl(Math.max(ad, 0)) }),
      ad > 0 && p > 0 ? el("span", { class: "meta", text: `${((ad / p) * 100).toFixed(1).replace(".", ",")}% do valor do pedido` }) : null,
      ad <= 0 ? el("p", { class: "warn-msg", text: "O valor combinado precisa ser maior que o valor da entrega." }) : null));
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    const e = valor($("#fi-entrega").value), p = valor($("#fi-valor-pedido").value), c = valor($("#fi-combinado").value);
    if ($("#fi-id").value.trim().length < 4) return falha("Digite o ID do entregador.");
    if (!radio("fi-origem")) return falha("Escolha de onde veio o pedido (QD ou outros).");
    if (!radio("fi-mercado")) return falha("Diga se o pedido é de mercado.");
    if (!$("#fi-motivo").value) return falha("Escolha o motivo do adicional.");
    if ([e, p, c].some((x) => x == null || Number.isNaN(x))) return falha("Preencha o valor da entrega, o valor do pedido e o valor combinado.");
    const btn = $("#fi-enviar");
    btn.disabled = true;
    try {
      const r = await rpc("registrar_adicional", { p_cidade: $("#fi-cidade").value || null, p_id_app: $("#fi-id").value.trim(), p_nome: $("#fi-nome").value.trim() || null,
        p_origem: radio("fi-origem"), p_mercado: radio("fi-mercado") === "sim", p_motivo: $("#fi-motivo").value,
        p_valor_entrega: e, p_valor_pedido: p, p_valor_combinado: c, p_lancado: $("#fi-lancado").checked,
        p_pedido: $("#fi-pedido").value.trim() || null, p_observacao: $("#fi-obs").value.trim() || null });
      toast(r.lancado ? `Adicional de ${brl(r.valor)} registrado.` : `Adicional de ${brl(r.valor)} registrado. Ficou em Adicionais pendentes até ser lançado.`);
      form.reset();
      App.carregar();
    } catch (err) { falha(msgErro(err)); } finally { btn.disabled = false; }
  });

  const descricao = (l) => l.tipo === "ajuste_bairro" ? `${l.bairro_informado} → ${l.bairro_real}` : `${l.motivo || "Adicional"}${l.mercado ? " · mercado" : ""} · pedido ${brl(l.valor_pedido)}`;
  function botaoLancar(l) {
    return el("button", { class: "btn small" + (l.lancado ? " quiet" : " primary"), type: "button", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await rpc("marcar_lancado", { p_id: l.id, p_lancado: !l.lancado }); toast(l.lancado ? "Voltou para pendente." : "Marcado como lançado."); App.carregar(); }
      catch (err) { e.currentTarget.disabled = false; toast(msgErro(err)); }
    } }, l.lancado ? "Desfazer lançado" : "Marcar como lançado");
  }
  function botaoApagar(l) {
    if (!(l.meu || S.me?.papel === "moderador" || S.me?.papel_bloqueios === "moderador")) return null;
    if (!G.confirmar[l.id]) return el("button", { class: "btn quiet small", type: "button", onclick: () => { G.confirmar[l.id] = true; App.render(); } }, "Apagar");
    return el("span", {}, el("button", { class: "btn danger small", type: "button", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await rpc("excluir_lancamento", { p_id: l.id }); delete G.confirmar[l.id]; toast("Registro apagado."); App.carregar(); }
      catch (err) { e.currentTarget.disabled = false; toast(msgErro(err)); }
    } }, "Confirmar"), el("button", { class: "btn link", type: "button", onclick: () => { delete G.confirmar[l.id]; App.render(); } }, "Cancelar"));
  }
  const cartao = (l, acoes = true) => el("article", { class: "card fin-card" + (l.lancado ? "" : " pendente") },
    el("div", { class: "head" },
      el("span", { class: "name" }, el("strong", { text: brl(l.valor) }), el("span", { class: "tag", text: TIPO[l.tipo] }),
        l.lancado ? el("span", { class: "pill aprovado", text: "Lançado" }) : el("span", { class: "pill aguardando_analise", text: "Não lançado" })),
      el("span", { class: "meta", text: dt(l.criado_em) })),
    el("div", {}, App.abrirFicha ? el("button", { class: "link-ficha", type: "button", onclick: () => App.abrirFicha(l.id_app) }, l.nome_entregador || "sem nome") : l.nome_entregador,
      " ", el("span", { class: "mono meta", text: l.id_app }), el("span", { class: "meta", text: ` · ${l.cidade || "sem cidade"} · ${ORIGEM[l.origem]}` })),
    el("div", { class: "meta", text: descricao(l) + (l.pedido ? ` · pedido nº ${l.pedido}` : "") + (l.observacao ? ` · ${l.observacao}` : "") }),
    l.lancado ? el("div", { class: "meta", text: `Lançado por ${l.lancado_por_nome || "—"} em ${dt(l.lancado_em)}` }) : null,
    acoes ? el("div", { class: "actions" }, botaoLancar(l), botaoApagar(l)) : null);

  function renderAdicional() {
    App.atalhoPendentes?.();
    const sel = $("#fi-cidade"), cids = G.cidades || [];
    if (sel.options.length !== cids.length + 1) {
      const atual = sel.value;
      sel.replaceChildren(el("option", { value: "", text: "Usar a cidade da ficha" }), ...cids.map((c) => el("option", { value: c, text: c })));
      sel.value = atual;
    }
    renderPrevia();
    const box = $("#fi-meus");
    if (!G.meus) return box.replaceChildren(carregandoEl());
    box.replaceChildren(...(G.meus.length ? G.meus.map((l) => cartao(l, !l.lancado)) : [vazio("Nada registrado nos últimos 7 dias", "Seus adicionais e ajustes aparecem aqui.")]));
  }
  function renderPendentes() {
    const box = $("#fi-pend-lista");
    if (!G.pend) return box.replaceChildren(G.erro ? vazio(G.erro) : carregandoEl());
    const total = G.pend.reduce((s, l) => s + Number(l.valor), 0);
    box.replaceChildren(...(G.pend.length
      ? [el("p", { class: "meta", text: `${G.pend.length} pendente(s), ${brl(total)} no total.` }), ...G.pend.map((l) => cartao(l))]
      : [vazio("Nada pendente", "Tudo o que você registrou já foi lançado no sistema.")]));
  }
  // ---------- lançamentos e números ----------
  ["#fi-l-dias", "#fi-l-cidade", "#fi-l-tipo"].forEach((s) => $(s).addEventListener("change", () => { G.lista = null; G.resumo = null; App.render(); App.carregar(); }));
  $("#fi-l-csv").addEventListener("click", () => {
    if (!G.lista) return;
    baixarCSV("financeiro", ["data", "tipo", "id_entregador", "nome", "cidade", "origem", "mercado", "motivo", "pedido", "bairro_informado", "bairro_real",
      "recebe_informado", "recebe_real", "valor_entrega", "valor_pedido", "valor_combinado", "valor", "lancado", "lancado_por", "lancado_em", "registrado_por", "observacao"],
    G.lista.map((l) => [l.criado_em, TIPO[l.tipo], l.id_app, l.nome_entregador, l.cidade, ORIGEM[l.origem], l.mercado == null ? "" : l.mercado ? "sim" : "não", l.motivo, l.pedido,
      l.bairro_informado, l.bairro_real, l.recebe_informado, l.recebe_real, l.valor_entrega, l.valor_pedido, l.valor_combinado, l.valor,
      l.lancado ? "sim" : "não", l.lancado_por_nome, l.lancado_em, l.registrado_por_nome, l.observacao]));
  });
  function renderLancamentos() {
    const R = G.resumo, sel = $("#fi-l-cidade");
    const cids = G.cidades || [];
    if (sel.options.length !== cids.length + 1) { const a = sel.value; sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...cids.map((c) => el("option", { value: c, text: c }))); sel.value = a; }
    const tile = (k, v, d, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }), d ? el("div", { class: "d", text: d }) : null);
    $("#fi-l-tiles").replaceChildren(...(R ? [
      tile("Total pago a mais", brl(R.total), `${R.n} registro(s)`),
      tile("Adicionais", brl(R.adicionais.total), `${R.adicionais.n} · pedidos somam ${brl(R.adicionais.pedidos)}`),
      tile("Ajustes de bairro", brl(R.ajustes.total), `${R.ajustes.n} registro(s)`),
      tile("Ainda não lançados", brl(R.pendentes.total), `${R.pendentes.n} registro(s)`, R.pendentes.n ? "hl" : "good"),
    ] : [carregandoEl()]));
    const painel = (titulo, ...c) => el("div", { class: "panel" }, el("h3", { text: titulo }), ...c);
    $("#fi-l-graficos").replaceChildren(...(R ? [
      painel("Por cidade", ...barras(R.por_cidade.map((x) => ({ rotulo: x.cidade, qtd: Number(x.total), extra: `${brl(x.total)} · ${x.n}` })), "var(--accent)", "Nada no período.")),
      painel("Motivos dos adicionais", ...barras(R.por_motivo.map((x) => ({ rotulo: x.motivo || "—", qtd: Number(x.total), extra: `${brl(x.total)} · ${x.n}` })), "var(--warn)", "Nenhum adicional no período.")),
      painel("Por tamanho do pedido (adicionais)", ...barras(R.faixas_pedido.map((x) => ({ rotulo: x.faixa, qtd: Number(x.total),
        extra: `${brl(x.total)} · ${x.n}${x.pct_pedido != null ? ` · ${String(x.pct_pedido).replace(".", ",")}% do pedido` : ""}` })), "#7a4bd1", "Nenhum adicional no período.")),
      painel("Origem e mercado",
        ...barras(R.por_origem.map((x) => ({ rotulo: ORIGEM[x.origem] || x.origem, qtd: Number(x.total), extra: `${brl(x.total)} · ${x.n}` })), "var(--ok)", "Nada no período."),
        el("p", { class: "meta", text: `Adicionais de mercado: ${brl(R.mercado.sim.total)} (${R.mercado.sim.n}) · fora de mercado: ${brl(R.mercado.nao.total)} (${R.mercado.nao.n})` })),
      painel("Bairros mais trocados (ajustes)", R.pares_bairros.length ? el("ol", { class: "lista-num" }, R.pares_bairros.map((x) =>
        el("li", {}, `${x.informado} → ${x.real}`, el("span", { class: "meta", text: ` · ${x.cidade} · ${x.n}× · ${brl(x.total)}` })))) : el("p", { class: "meta", text: "Nenhum ajuste no período." })),
      painel("Quem registrou", ...barras(R.por_pessoa.map((x) => ({ rotulo: x.nome, qtd: Number(x.total), extra: `${brl(x.total)} · ${x.n}` })), "var(--muted)", "Nada no período.")),
    ] : []));
    const t = $("#fi-l-tabela");
    if (!G.lista) return t.replaceChildren(...tabela([["Data"]], [], G.erro || "Carregando…"));
    t.replaceChildren(...tabela([["Data"], ["Tipo"], ["Entregador"], ["Cidade"], ["Detalhe"], ["Valor", 1], ["Lançado"], [""]],
      G.lista.map((l) => el("tr", {},
        el("td", { class: "nowrap-data", text: dt(l.criado_em) }), el("td", { text: TIPO[l.tipo] }),
        el("td", {}, l.nome_entregador || "sem nome", el("div", { class: "meta mono", text: l.id_app })),
        el("td", { text: l.cidade || "—" }),
        el("td", {}, descricao(l), el("div", { class: "meta", text: `${ORIGEM[l.origem]} · por ${l.registrado_por_nome || "—"}` })),
        el("td", { class: "num" }, el("strong", { text: brl(l.valor) })),
        el("td", { text: l.lancado ? `Sim, ${l.lancado_por_nome || ""}` : "Não" }),
        el("td", { style: "white-space:nowrap" }, botaoLancar(l), botaoApagar(l)))),
      "Nenhum registro com esse filtro."));
  }

  App.modulo({
    id: "financeiro", nome: "Financeiro",
    abas: [
      { id: "adicional", nome: "Registrar adicional", secao: "v-fi-adicional" },
      { id: "pendentes", nome: "Adicionais pendentes", secao: "v-fi-pendentes", contador: "c-fin-pend", alerta: true },
      { id: "lancamentos", nome: "Lançamentos", secao: "v-fi-lancamentos" },
    ],
    async carregar(aba) {
      try {
        if (!G.cidades) G.cidades = (await rpc("tarifas_bairros")).cidades.map((c) => c.nome);
        if (aba === "adicional") G.meus = (await rpc("listar_lancamentos", { p_meus: true, p_dias: 7, p_limite: 8 })).itens;
        else if (aba === "pendentes") G.pend = (await rpc("listar_lancamentos", { p_pendentes: true, p_meus: true })).itens;
        else {
          const dias = Number($("#fi-l-dias").value), cidade = $("#fi-l-cidade").value || null;
          const [l, r] = await Promise.all([
            rpc("listar_lancamentos", { p_tipo: $("#fi-l-tipo").value || null, p_cidade: cidade, p_dias: dias, p_limite: 5000 }),
            rpc("resumo_financeiro", { p_dias: dias, p_cidade: cidade })]);
          G.lista = l.itens; G.resumo = r;
        }
        G.erro = null;
      } catch (e) { G.erro = msgErro(e); throw e; }
    },
    render: (aba) => (aba === "pendentes" ? renderPendentes() : aba === "lancamentos" ? renderLancamentos() : renderAdicional()),
    contadores() {
      const n = S.resumo?.financeiro_pendentes || 0;
      App.contador("c-fin", n); App.contador("c-fin-pend", n);
    },
  });
})();
