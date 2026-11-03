// Módulo "Ativação de entregadores": envio de cadastros, aprovação, painel e histórico.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, onlyDigits, fmtCPF, cpfValido, norm, dt, dia, duracao, num, horas, toast, CIDADES, ST, PAPEL, EVENTO, pill, titulo,
          vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  Object.assign(S, {
    lista: { pendentes: null, meus: null, todos: null }, metricas: null,
    filtro: "todos", escolhidos: new Set(), destaque: null,
    caixa: {},          // caixas abertas nos cards: id -> { acao, motivo, detalhe }
    eventos: {},        // histórico carregado por cadastro
    abertos: new Set(), // linhas com histórico aberto
  });
  const staff = () => ["moderador", "monitorador"].includes(S.me?.papel);
  const mod = () => S.me?.papel === "moderador";
  const render = () => App.render();
  const carregar = () => App.carregar();

  ["#f-meus-status", "#f-hist-status"].forEach((s) => $(s).append(el("option", { value: "", text: "Todas as situações" }), ...Object.entries(ST).map(([v, t]) => el("option", { value: v, text: t }))));
  const busca = (c, q) => !q || norm([c.id_app, c.cpf, fmtCPF(c.cpf), c.cidade, c.enviado_por_nome, c.observacao].join(" ")).includes(norm(q));
  function opcoesCidade(sel, lista) {
    const cs = [...new Set(lista.map((c) => c.cidade))].sort();
    const cur = sel.value, have = [...sel.options].slice(1).map((o) => o.value).join("|");
    if (have === cs.join("|")) return;
    sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...cs.map((c) => el("option", { value: c, text: c })));
    sel.value = cs.includes(cur) ? cur : "";
  }

  // ---------- pendentes ----------
  function renderPendentes() {
    $("#pend-titulo").textContent = staff() ? "Cadastros em andamento" : "Seus cadastros em andamento";
    $("#pend-sub").textContent = staff()
      ? "Do que espera há mais tempo para o mais recente. Aprovados e encerrados saem desta lista."
      : "Acompanhe aqui a análise do que você enviou. Aprovados e encerrados ficam em Meus cadastros.";
    const box = $("#queue");
    if (!S.lista.pendentes) return box.replaceChildren(carregandoEl());
    opcoesCidade($("#f-pend-cidade"), S.lista.pendentes);
    const q = $("#q-pend").value, st = $("#f-pend-status").value, cid = $("#f-pend-cidade").value;
    const lista = S.lista.pendentes.filter((c) => busca(c, q) && (!st || c.status === st) && (!cid || c.cidade === cid));
    if (!S.lista.pendentes.length) return box.replaceChildren(vazio("Nada em andamento", staff() ? "Nenhum cadastro esperando. Os novos aparecem aqui assim que forem enviados." : "Quando você enviar um cadastro, ele aparece aqui com a situação da análise."));
    if (!lista.length) return box.replaceChildren(vazio("Nenhum cadastro com esse filtro", "Limpe a busca ou troque os filtros."));
    const grupos = ["aguardando_analise", "aguardando_contato"].map((s) => [s, lista.filter((c) => c.status === s)]).filter(([, l]) => l.length);
    box.replaceChildren(...grupos.map(([s, l]) => el("div", { class: "grupo" },
      el("h3", {}, ST[s], el("span", { class: "count", text: l.length })),
      el("div", { class: "queue" }, l.map(card)))));
    if (S.destaque) {
      const n = box.querySelector(`[data-id="${S.destaque}"]`);
      if (n) { n.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => { S.destaque = null; render(); }, 8000); S.destaque = "_mostrado_" + S.destaque; }
    }
  }

  function card(c) {
    const esp = duracao(c.status_desde), env = duracao(c.enviado_em);
    const contato = c.status === "aguardando_contato";
    const destacado = S.destaque === c.id || S.destaque === "_mostrado_" + c.id;
    const cx = S.caixa[c.id];
    return el("article", { class: "card" + (contato ? " contato" : "") + (destacado ? " destaque" : ""), "data-id": c.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, el("span", { class: "mono", text: titulo(c) }), pill(c.status, true), destacado ? el("span", { class: "tag", text: "RECÉM-ENVIADO" }) : null),
        el("span", { class: "espera" + (esp.velho ? " velho" : ""), title: "Desde " + dt(c.status_desde), text: (contato ? "aguardando contato há " : "esperando há ") + esp.txt })),
      el("dl", { class: "fields" },
        fld("ID do entregador", c.id_app, true), fld("CPF", c.cpf && fmtCPF(c.cpf), true), fld("Cidade", c.cidade),
        fld("Enviado", `${dt(c.enviado_em)} (há ${env.txt})`),
        staff() ? fld("Enviado por", c.enviado_por === S.me.id ? "Você" : c.enviado_por_nome) : null),
      contato ? el("div", { class: "motivo" }, el("b", { text: `Reprovado por ${c.decidido_por_nome} em ${dt(c.decidido_em)}: ` }), c.motivo, c.detalhe ? " — " + c.detalhe : "") : null,
      c.observacao ? el("div", { class: "obs", text: c.observacao }) : null,
      el("div", { class: "actions" },
        staff() ? el("button", { class: "btn approve", type: "button", onclick: (e) => decidir(c, "aprovar", e.currentTarget) }, "Aprovar") : null,
        staff() && !contato ? el("button", { class: "btn reject", type: "button", onclick: () => abrir(c.id, "reprovar") }, "Reprovar") : null,
        el("button", { class: "btn small", type: "button", onclick: () => copiar(c) }, "Copiar dados"),
        botaoHistorico(c.id),
        !staff() ? el("span", { class: "meta", text: contato ? "O responsável vai retomar o contato com o entregador." : "Aguardando análise do responsável." }) : null,
        el("span", { class: "spacer" }),
        staff() ? el("button", { class: "btn quiet small", type: "button", onclick: () => abrir(c.id, "encerrar") }, "Encerrar…") : null),
      cx ? caixa(c, cx) : null,
      S.abertos.has(c.id) ? timeline(c.id) : null);
  }
  const fld = (k, v, mono) => el("div", {}, el("dt", { text: k }), el("dd", { class: mono ? "mono" : null, text: v || "—" }));

  function abrir(id, acao) { S.caixa[id] = S.caixa[id]?.acao === acao ? undefined : { acao, motivo: "", detalhe: "" }; render(); }
  function caixa(c, cx) {
    const enc = cx.acao === "encerrar";
    const sel = el("select", { "aria-label": enc ? "Motivo do encerramento" : "Motivo da reprovação", onchange: (e) => (cx.motivo = e.target.value) },
      el("option", { value: "", text: "Escolha o motivo" }), ...S.motivos[enc ? "encerramento" : "reprovacao"].map((m) => el("option", { value: m, text: m })));
    sel.value = cx.motivo;
    const txt = el("input", { placeholder: "Detalhe (obrigatório se escolher Outro)", "aria-label": "Detalhe", maxlength: "300", oninput: (e) => (cx.detalhe = e.target.value) });
    txt.value = cx.detalhe;
    return el("div", { class: "box" + (enc ? " encerrar" : "") },
      enc ? el("p", { class: "meta", style: "margin:0", text: "Encerrar é definitivo: o cadastro sai de Pendentes e não volta para análise. Use só em casos como CPF com restrição ou suspeita de fraude." }) : null,
      el("div", { class: "grid2" }, sel, txt),
      el("div", { class: "actions" },
        el("button", { class: enc ? "btn danger small" : "btn reject small", type: "button", onclick: (e) => decidir(c, cx.acao, e.currentTarget, cx.motivo, cx.detalhe) }, enc ? "Confirmar encerramento" : "Confirmar reprovação"),
        el("button", { class: "btn link", type: "button", onclick: () => { delete S.caixa[c.id]; render(); } }, "Cancelar")));
  }

  async function decidir(c, acao, btn, motivo = null, detalhe = null) {
    if (acao !== "aprovar" && !motivo) return toast("Escolha o motivo.");
    if (motivo === "Outro" && !String(detalhe || "").trim()) return toast("Descreva o motivo no detalhe.");
    btn.disabled = true;
    try {
      await rpc("decidir", { p_cadastro: c.id, p_acao: acao, p_motivo: motivo, p_detalhe: detalhe });
      delete S.caixa[c.id]; delete S.eventos[c.id];
      toast({ aprovar: "Cadastro aprovado.", reprovar: "Cadastro reprovado: agora aguarda novo contato.", encerrar: "Cadastro encerrado." }[acao]);
      await carregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }

  async function copiar(c) {
    const t = [c.id_app ? `ID: ${c.id_app}` : "", c.cpf ? `CPF: ${fmtCPF(c.cpf)}` : "", `Cidade: ${c.cidade}`, c.observacao ? `Obs.: ${c.observacao}` : ""].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(t); toast("Dados copiados."); } catch (_) { toast("Não foi possível copiar neste navegador."); }
  }

  // ---------- histórico de eventos de um cadastro ----------
  function botaoHistorico(id) {
    return el("button", { class: "btn link", type: "button", "aria-expanded": String(S.abertos.has(id)), onclick: (e) => { e.stopPropagation(); alternar(id); } }, S.abertos.has(id) ? "Ocultar histórico" : "Ver histórico");
  }
  async function alternar(id) {
    if (S.abertos.has(id)) S.abertos.delete(id); else S.abertos.add(id);
    render();
    if (S.abertos.has(id) && !S.eventos[id]) {
      try { S.eventos[id] = await rpc("eventos_do_cadastro", { p_cadastro: id }); } catch (e) { S.eventos[id] = { erro: msgErro(e) }; }
      render();
    }
  }
  function timeline(id) {
    const ev = S.eventos[id];
    if (!ev) return el("p", { class: "meta", text: "Carregando histórico…" });
    if (ev.erro) return el("p", { class: "err", text: ev.erro });
    return el("ol", { class: "timeline" }, ev.map((e) => el("li", {},
      el("b", { text: EVENTO[e.tipo] }), ` por ${e.por_nome} em ${dt(e.em)}`,
      e.tipo !== "enviado" && e.tipo !== "desfeito" ? ` → ${ST[e.status_novo]}` : "",
      e.motivo && e.tipo !== "desfeito" ? ` · ${e.motivo}${e.detalhe ? ": " + e.detalhe : ""}` : "")));
  }

  // ---------- meus cadastros ----------
  function renderMeus() {
    const t = $("#t-meus");
    const l = S.lista.meus;
    const cont = (s) => (l || []).filter((c) => !s || c.status === s).length;
    const tile = (k, v, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: l ? v : "…" }));
    $("#meus-tiles").replaceChildren(tile("Enviados", cont()), tile("Aguardando análise", cont("aguardando_analise"), "hl"),
      tile("Aguardando novo contato", cont("aguardando_contato"), "hl2"), tile("Aprovados", cont("aprovado"), "good"), tile("Encerrados", cont("encerrado")));
    const head = el("thead", {}, el("tr", {}, ...["Situação", "Entregador", "Cidade", "Enviado em", "Situação atual desde", "Motivo", ""].map((h) => el("th", { text: h }))));
    if (!l) return t.replaceChildren(head, el("tbody", {}, el("tr", {}, el("td", { colspan: "7", class: "meta", text: "Carregando…" }))));
    const q = $("#q-meus").value, st = $("#f-meus-status").value;
    const lista = l.filter((c) => busca(c, q) && (!st || c.status === st)).sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)));
    const body = el("tbody");
    if (!lista.length) body.append(el("tr", {}, el("td", { colspan: "7", class: "meta", text: l.length ? "Nenhum cadastro com esse filtro." : "Você ainda não enviou cadastros." })));
    for (const c of lista) {
      body.append(el("tr", { class: "clicavel", onclick: () => alternar(c.id) },
        el("td", {}, pill(c.status, true)),
        el("td", { class: "mono" }, c.id_app || "—", el("br"), el("span", { class: "meta", text: c.cpf ? fmtCPF(c.cpf) : "" })),
        el("td", { text: c.cidade }), el("td", { text: dt(c.enviado_em) }),
        el("td", { text: `${dt(c.status_desde)} (há ${duracao(c.status_desde).txt})` }),
        el("td", { class: "meta", text: c.motivo ? c.motivo + (c.detalhe ? ": " + c.detalhe : "") : "—" }),
        el("td", {}, botaoHistorico(c.id))));
      if (S.abertos.has(c.id)) body.append(el("tr", {}, el("td", { colspan: "7" }, timeline(c.id))));
    }
    t.replaceChildren(head, body);
  }

  // ---------- painel ----------
  function pessoasFiltro() {
    if (S.filtro === "eu") return [S.me.id];
    if (S.filtro === "escolher") return S.escolhidos.size ? [...S.escolhidos] : [S.me.id];
    return null;
  }
  document.querySelectorAll("[data-filtro]").forEach((b) => b.addEventListener("click", () => {
    S.filtro = b.dataset.filtro;
    if (S.filtro === "escolher" && !S.escolhidos.size) S.escolhidos.add(S.me.id);
    S.metricas = null; render(); carregar();
  }));
  function renderPessoas() {
    const box = $("#pessoas");
    box.hidden = S.filtro !== "escolher";
    if (box.hidden) return;
    box.replaceChildren(...S.pessoas.map((p) => {
      const cb = el("input", { type: "checkbox", value: p.id, onchange: (e) => {
        if (e.target.checked) S.escolhidos.add(p.id); else S.escolhidos.delete(p.id);
        S.metricas = null; render(); carregar();
      } });
      cb.checked = S.escolhidos.has(p.id);
      return el("label", {}, cb, p.id === S.me.id ? `${p.nome} (você)` : p.nome);
    }));
  }
  function renderPainel() {
    document.querySelectorAll("[data-filtro]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filtro === S.filtro)));
    renderPessoas();
    const m = S.metricas;
    const quem = S.filtro === "todos" ? "toda a equipe" : S.filtro === "eu" ? "você" :
      S.pessoas.filter((p) => S.escolhidos.has(p.id)).map((p) => p.id === S.me.id ? "você" : p.nome).join(", ");
    $("#painel-sub").textContent = S.filtro === "todos"
      ? "Números da operação inteira, atualizados em tempo real."
      : `Cadastros enviados ou decididos por ${quem}.`;
    if (!m) { $("#tiles").replaceChildren(vazio("Carregando…")); return; }
    const r = m.resumo;
    const mes = new Date().toLocaleDateString("pt-BR", { month: "long" });
    const tile = (k, v, d, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }), el("div", { class: "d", text: d }));
    $("#tiles").replaceChildren(
      tile("Aguardando análise", r.aguardando_analise, "agora", "hl"),
      tile("Aguardando novo contato", r.aguardando_contato, "agora", "hl2"),
      tile("Aprovados hoje", r.aprovados_hoje, new Date().toLocaleDateString("pt-BR"), "good"),
      tile("Aprovados em 7 dias", r.aprovados_7d, "últimos 7 dias", "good"),
      tile(`Aprovados em ${mes}`, r.aprovados_mes, `${r.encerrados_mes} encerrado(s) no mês`, "good"),
      tile("Aprovados na 1ª análise", r.aprovacao_1a_analise == null ? "—" : r.aprovacao_1a_analise + "%", "sem reprovação antes"),
      tile("Tempo até aprovação", horas(r.horas_ate_aprovacao), "média, do envio à aprovação"),
      tile("Cadastros", r.total, S.filtro === "todos" ? "no total" : "relacionados"));

    // gráfico 14 dias: barras empilhadas de decisões + pontos de enviados
    const data = m.por_dia;
    const max = Math.max(1, ...data.map((x) => Math.max(x.aprovados + x.reprovados + x.encerrados, x.enviados)));
    const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step;
    const W = 700, H = 230, L = 30, B = 26, T = 22, cw = (W - L - 6) / data.length, bw = Math.min(26, cw * 0.58);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Enviados, aprovados, reprovados e encerrados por dia nos últimos 14 dias");
    const add = (tag, at, txt) => { const n = document.createElementNS(ns, tag); for (const k in at) n.setAttribute(k, at[k]); if (txt != null) n.textContent = txt; svg.append(n); return n; };
    const tip = (n, t) => n.append(Object.assign(document.createElementNS(ns, "title"), { textContent: t }));
    for (let v = 0; v <= top; v += step) { add("line", { x1: L, x2: W - 4, y1: y(v), y2: y(v), class: "grid" }); add("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v); }
    data.forEach((x, i) => {
      const cx = L + cw * i + cw / 2; let base = 0;
      for (const [k, cor, nome] of [["aprovados", "var(--ok)", "aprovado(s)"], ["reprovados", "var(--bad)", "reprovado(s)"], ["encerrados", "var(--gray)", "encerrado(s)"]]) {
        if (!x[k]) continue;
        tip(add("rect", { x: cx - bw / 2, y: y(base + x[k]), width: bw, height: y(base) - y(base + x[k]), fill: cor }), `${dia(x.dia)}: ${x[k]} ${nome}`);
        base += x[k];
      }
      if (x.enviados) tip(add("circle", { cx, cy: y(x.enviados), r: 4, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 1.5 }), `${dia(x.dia)}: ${x.enviados} enviado(s)`);
      if (i % 2 === 1 || i === data.length - 1) add("text", { x: cx, y: H - 8, "text-anchor": "middle" }, dia(x.dia));
    });
    $("#chart").replaceChildren(svg);

    const tabela = (cols, linhas, vazioTxt) => [
      el("thead", {}, el("tr", {}, cols.map(([t, n]) => el("th", { class: n ? "num" : null, text: t })))),
      el("tbody", {}, linhas.length ? linhas : el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: vazioTxt })))];
    $("#t-cidade").replaceChildren(...tabela(
      [["Cidade"], ["Recebidos", 1], ["Em andamento", 1], ["Aprovados", 1], ["Reprovações", 1], ["Encerrados", 1], ["Tempo até aprovação", 1]],
      m.por_cidade.map((c) => el("tr", {}, el("td", { text: c.cidade }), ...[c.recebidos, c.em_andamento, c.aprovados, c.reprovacoes, c.encerrados].map((v) => el("td", { class: "num", text: v })), el("td", { class: "num", text: horas(c.horas_ate_aprovacao) }))),
      "Nenhum cadastro ainda."));

    const barras = (lista, cor, vazioTxt) => {
      const mx = Math.max(1, ...lista.map((x) => x.qtd));
      return lista.length ? lista.map((x) => el("div", { style: "display:grid;gap:4px;margin-bottom:10px" },
        el("div", { style: "display:flex;justify-content:space-between;gap:8px;font-size:14px" }, el("span", { text: x.motivo }), el("strong", { style: "font-variant-numeric:tabular-nums", text: x.pct != null ? `${x.qtd} (${x.pct}%)` : x.qtd })),
        el("div", { class: "bar" }, el("span", { style: `width:${(x.qtd / mx) * 100}%;background:${cor}` }))))
        : [el("p", { class: "meta", text: vazioTxt })];
    };
    $("#motivos-rep").replaceChildren(...barras(m.motivos_reprovacao, "var(--bad)", "Nenhuma reprovação."));
    $("#motivos-enc").replaceChildren(...barras(m.motivos_encerramento, "var(--gray)", "Nenhum encerramento."));

    $("#t-pessoa").replaceChildren(...tabela(
      [["Pessoa"], ["Acesso"], ["Enviados", 1], ["Envios por dia (14 dias)", 1], ["Aprovou", 1], ["Reprovou", 1], ["Encerrou", 1]],
      m.por_pessoa.map((p) => el("tr", {}, el("td", { text: p.id === S.me.id ? `${p.nome} (você)` : p.nome }), el("td", { text: PAPEL[p.papel] }),
        el("td", { class: "num", text: p.enviados }), el("td", { class: "num", text: (p.enviados_14d / 14).toFixed(1).replace(".", ",") }),
        el("td", { class: "num", text: p.aprovou }), el("td", { class: "num", text: p.reprovou }), el("td", { class: "num", text: p.encerrou }))),
      "Sem atividade."));
  }

  // ---------- histórico ----------
  function renderHist() {
    const t = $("#t-hist"), l = S.lista.todos;
    const cols = ["Situação", "Entregador", "Cidade", "Enviado por", "Enviado em", "Última decisão", ""];
    const head = el("thead", {}, el("tr", {}, cols.map((h) => el("th", { text: h }))));
    if (!l) return t.replaceChildren(head, el("tbody", {}, el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: "Carregando…" }))));
    opcoesCidade($("#f-hist-cidade"), l);
    const q = $("#q-hist").value, st = $("#f-hist-status").value, cid = $("#f-hist-cidade").value;
    const lista = l.filter((c) => busca(c, q) && (!st || c.status === st) && (!cid || c.cidade === cid)).sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)));
    const body = el("tbody");
    if (!lista.length) body.append(el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: "Nenhum cadastro encontrado." })));
    for (const c of lista) {
      const acoes = el("td", { style: "white-space:nowrap", onclick: (e) => e.stopPropagation() }, botaoHistorico(c.id));
      if (mod()) {
        if (c.pode_desfazer) acoes.append(el("button", { class: "btn link", type: "button", onclick: (e) => desfazer(c, e.currentTarget) }, "Desfazer"));
        if (S.confirmar["x" + c.id]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => excluir(c, e.currentTarget) }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete S.confirmar["x" + c.id]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { S.confirmar["x" + c.id] = true; render(); } }, "Excluir"));
      }
      body.append(el("tr", { class: "clicavel", onclick: () => alternar(c.id) },
        el("td", {}, pill(c.status, true), c.reprovacoes ? el("div", { class: "meta", text: `${c.reprovacoes} reprovação(ões)` }) : null),
        el("td", { class: "mono" }, c.id_app || "—", el("br"), el("span", { class: "meta", text: c.cpf ? fmtCPF(c.cpf) : "" })),
        el("td", { text: c.cidade }), el("td", { text: c.enviado_por === S.me.id ? "Você" : c.enviado_por_nome }), el("td", { text: dt(c.enviado_em) }),
        el("td", { class: "meta", text: c.decidido_em ? `${dt(c.decidido_em)} por ${c.decidido_por_nome}${c.motivo ? ` · ${c.motivo}${c.detalhe ? ": " + c.detalhe : ""}` : ""}` : "—" }),
        acoes));
      if (S.abertos.has(c.id)) body.append(el("tr", {}, el("td", { colspan: cols.length }, timeline(c.id))));
    }
    t.replaceChildren(head, body);
  }
  async function desfazer(c, btn) {
    btn.disabled = true;
    try { await rpc("desfazer", { p_cadastro: c.id }); delete S.eventos[c.id]; toast("Decisão desfeita."); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function excluir(c, btn) {
    btn.disabled = true;
    try { await rpc("excluir_cadastro", { p_cadastro: c.id }); delete S.confirmar["x" + c.id]; toast("Cadastro excluído."); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  $("#b-export").addEventListener("click", () => {
    const cols = ["id_entregador", "cpf", "cidade", "observacao", "situacao", "enviado_por", "enviado_em", "situacao_desde", "decidido_por", "decidido_em", "motivo", "detalhe", "reprovacoes"];
    const esc = (x) => { x = x == null ? "" : String(x); return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const linhas = (S.lista.todos || []).slice().sort((a, b) => String(a.enviado_em).localeCompare(String(b.enviado_em))).map((c) =>
      [c.id_app, c.cpf && fmtCPF(c.cpf), c.cidade, c.observacao, ST[c.status], c.enviado_por_nome, c.enviado_em, c.status_desde, c.decidido_por_nome, c.decidido_em, c.motivo, c.detalhe, c.reprovacoes].map(esc).join(";"));
    const hoje = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob(["﻿" + [cols.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = el("a", { href: url, download: `cadastros-entregadores-${hoje}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ---------- aprovados: foram bloqueados depois? (fim do Histórico) ----------
  function renderAprovados() {
    const l = S.aprovados, t = $("#t-aprovados");
    const cols = [["Aprovado em"], ["Entregador"], ["Cidade"], ["Enviado por"], ["Bloqueios depois", 1], ["1º bloqueio"], ["Dias até o 1º", 1], ["Agora"]];
    if (!l) { $("#ap-resumo").textContent = "Carregando…"; return t.replaceChildren(...App.u.tabela(cols, [], "Carregando…")); }
    const bloq = l.filter((x) => x.bloqueios > 0);
    const media = bloq.length ? Math.round((10 * bloq.reduce((s, x) => s + Number(x.dias_ate_bloqueio), 0)) / bloq.length) / 10 : null;
    $("#ap-resumo").textContent = l.length
      ? `${l.length} aprovado(s) pelo sistema · ${bloq.length} bloqueado(s) depois da aprovação (${Math.round((100 * bloq.length) / l.length)}%)` + (media != null ? ` · em média ${String(media).replace(".", ",")} dias até o 1º bloqueio.` : ".")
      : "Nenhum cadastro aprovado ainda.";
    const lista = $("#ap-so-bloq").checked ? bloq : l;
    const nome = (x) => {
      const txt = x.nome || "ID " + x.id_app;
      return S.me.papel_bloqueios && App.abrirFicha ? el("button", { class: "link-ficha", type: "button", title: "Consultar entregador", onclick: () => App.abrirFicha(x.id_app) }, txt) : txt;
    };
    t.replaceChildren(...App.u.tabela(cols, lista.map((x) => el("tr", {},
      el("td", { text: dt(x.aprovado_em) }),
      el("td", {}, nome(x), el("br"), el("span", { class: "mono meta", text: x.id_app })),
      el("td", { text: x.cidade }), el("td", { text: x.enviado_por_nome }),
      el("td", { class: "num", text: x.bloqueios }),
      el("td", { text: x.primeiro_bloqueio ? dt(x.primeiro_bloqueio) : "—" }),
      el("td", { class: "num", text: x.dias_ate_bloqueio == null ? "—" : String(x.dias_ate_bloqueio).replace(".", ",") }),
      el("td", { text: x.encerrado ? "Parceria encerrada" : x.bloqueado_agora ? "Bloqueado" : x.bloqueios ? "Liberado" : "—" }))),
      $("#ap-so-bloq").checked ? "Nenhum aprovado foi bloqueado depois." : "Nenhum cadastro aprovado ainda."));
  }
  $("#ap-so-bloq").addEventListener("change", () => renderAprovados());

  // ---------- novo cadastro ----------
  const form = $("#form");
  $("#f-cpf").addEventListener("input", (e) => (e.target.value = fmtCPF(e.target.value)));
  $("#f-idapp").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "")));
  $("#f-cidade").addEventListener("blur", (e) => (e.target.value = e.target.value.trim().replace(/\s+/g, " ").toUpperCase()));
  // sugestões de cidade: a lista de cidades do sistema (aba Regras dos bloqueios); a fixa fica de reserva
  const sugerirCidades = (lista) => $("#cidades").replaceChildren(...lista.map((c) => el("option", { value: c })));
  sugerirCidades(CIDADES);
  let cidadesEm = 0;
  function atualizarCidades() {
    if (Date.now() - cidadesEm < 300000) return;
    cidadesEm = Date.now();
    rpc("listar_cidades").then((l) => { if (l?.length) sugerirCidades(l); }).catch(() => { cidadesEm = 0; });
  }
  form.addEventListener("input", () => ($("#form-erro").hidden = true));
  form.addEventListener("reset", () => setTimeout(() => { ["idapp", "cpf", "cidade"].forEach((k) => ($("#e-" + k).textContent = "")); $("#form-erro").hidden = true; }));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = { idApp: $("#f-idapp").value.trim(), cpf: $("#f-cpf").value, cidade: $("#f-cidade").value.trim().replace(/\s+/g, " ").toUpperCase(), obs: $("#f-obs").value.trim() };
    const temId = !!v.idApp, temCpf = !!onlyDigits(v.cpf);
    const errs = {
      idapp: !temId && !temCpf ? "Preencha o ID do entregador ou o CPF." : temId && v.idApp.length < 4 ? "ID muito curto. Confira." : "",
      cpf: temCpf && !cpfValido(v.cpf) ? "CPF inválido. Confira os 11 números ou deixe em branco." : "",
      cidade: !/^.+ - [A-Z]{2}$/.test(v.cidade) ? "Use o formato CIDADE - UF, ex.: LAGARTO - SE." : "",
    };
    for (const k in errs) $("#e-" + k).textContent = errs[k];
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) return $("#f-" + first).focus();
    const btn = $("#b-enviar"); btn.disabled = true;
    try {
      const id = await rpc("enviar_cadastro", { p_id_app: v.idApp || null, p_cpf: temCpf ? v.cpf : null, p_cidade: v.cidade, p_observacao: v.obs || null });
      const cidade = v.cidade;
      form.reset(); setTimeout(() => ($("#f-cidade").value = cidade));
      S.destaque = id;
      toast("Cadastro enviado. Ele já está em Pendentes.");
      location.hash = "#ativacao/pendentes";
    } catch (e) {
      const erro = $("#form-erro"); erro.textContent = msgErro(e); erro.hidden = false;
    } finally { btn.disabled = false; }
  });

  // ---------- filtros ----------
  ["#q-pend", "#f-pend-status", "#f-pend-cidade", "#q-meus", "#f-meus-status", "#q-hist", "#f-hist-status", "#f-hist-cidade"].forEach((s) => $(s).addEventListener("input", render));

  App.modulo({
    id: "ativacao", nome: "Ativação de entregadores",
    acesso: () => !!S.me?.papel,
    abas: [
      { id: "pendentes", nome: "Pendentes", secao: "v-pendentes", contador: "c-pend" },
      { id: "novo", nome: "Novo cadastro", secao: "v-novo" },
      { id: "meus", nome: "Meus cadastros", secao: "v-meus" },
      { id: "painel", nome: "Painel", secao: "v-painel" },
      { id: "historico", nome: "Histórico", secao: "v-historico", pode: staff },
    ],
    padrao: () => "pendentes",
    async carregar(aba) {
      if (aba === "novo") atualizarCidades();
      const t = [rpc("listar_cadastros", { p_escopo: "pendentes" }).then((d) => (S.lista.pendentes = d))];
      if (aba === "meus") t.push(rpc("listar_cadastros", { p_escopo: "meus" }).then((d) => (S.lista.meus = d)));
      if (aba === "historico") t.push(rpc("listar_cadastros", { p_escopo: "todos" }).then((d) => (S.lista.todos = d)),
                                      rpc("aprovados_e_bloqueios").then((d) => (S.aprovados = d)));
      if (aba === "painel") t.push(rpc("metricas", { p_pessoas: pessoasFiltro() }).then((d) => (S.metricas = d)));
      await Promise.all(t);
    },
    render(aba) {
      ({ pendentes: renderPendentes, meus: renderMeus, painel: renderPainel, historico: () => { renderHist(); renderAprovados(); } })[aba]?.();
    },
    contadores() {
      const r = S.resumo?.ativacao;
      if (r) App.contador("c-pend", staff() ? r.aguardando_analise : r.aguardando_analise + r.aguardando_contato);
    },
  });
})();
