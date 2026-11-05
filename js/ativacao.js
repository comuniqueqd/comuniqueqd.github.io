// Módulo "Ativação de entregadores": envio de cadastros, aprovação, painel e histórico.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, onlyDigits, fmtCPF, cpfValido, norm, dt, dia, duracao, num, horas, toast, CIDADES, ST, PAPEL, EVENTO, pill, titulo,
          vazio, carregandoEl, rpc, msgErro, tabela, barras, grafico, baixarCSV, filtroPessoas, caixaPessoas } = App.u;
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

  ["#f-hist-status"].forEach((s) => $(s).append(el("option", { value: "", text: "Todas as situações" }), ...Object.entries(ST).map(([v, t]) => el("option", { value: v, text: t })),
    el("option", { value: "revisar", text: "Para revisar (dados faltando)" })));
  const busca = (c, q) => !q || norm([c.id_app, c.cpf, fmtCPF(c.cpf), c.nome, c.cidade, c.enviado_por_nome, c.observacao].join(" ")).includes(norm(q));
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
    const prevPassou = c.previsao && new Date(c.previsao) < Date.now();
    return el("article", { class: "card" + (contato ? " contato" : "") + (prevPassou ? " previsao-passou" : "") + (destacado ? " destaque" : ""), "data-id": c.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, c.nome ? el("span", { text: c.nome }) : null, el("span", { class: "mono" + (c.nome ? " meta" : ""), text: titulo(c) }), pill(c.status, true),
          destacado ? el("span", { class: "tag", text: "RECÉM-ENVIADO" }) : null, c.revisar ? botaoRevisar(c, true) : null),
        el("span", { class: "espera" + (esp.velho ? " velho" : ""), title: "Desde " + dt(c.status_desde), text: (contato ? "aguardando contato há " : "esperando há ") + esp.txt })),
      el("dl", { class: "fields" },
        fld("Nome", c.nome), fld("ID do entregador", c.id_app, true), fld("CPF", c.cpf && fmtCPF(c.cpf), true), fld("Cidade", c.cidade),
        fld("Enviado", `${dt(c.enviado_em)} (há ${env.txt})`),
        staff() ? fld("Enviado por", c.enviado_por === S.me.id ? "Você" : c.enviado_por_nome) : null),
      App.u.previsao(c, "cadastro", c.id, staff()),
      c.historico ? resumoHistorico(c.historico, c.id_app) : null,
      contato ? el("div", { class: "motivo" }, el("b", { text: `Reprovado por ${c.decidido_por_nome} em ${dt(c.decidido_em)}: ` }), c.motivo, c.detalhe ? " — " + c.detalhe : "") : null,
      c.observacao ? el("div", { class: "obs", text: c.observacao }) : null,
      el("div", { class: "actions" },
        staff() ? el("button", { class: "btn approve", type: "button", onclick: (e) => decidir(c, "aprovar", e.currentTarget) }, "Aprovar") : null,
        staff() && !contato ? el("button", { class: "btn reject", type: "button", onclick: () => abrir(c.id, "reprovar") }, "Reprovar") : null,
        el("button", { class: "btn small", type: "button", onclick: () => copiar(c) }, "Copiar dados"),
        el("button", { class: "btn link", type: "button", onclick: () => App.abrirCadastro(c.id) }, "Editar dados"),
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
    const t = [c.nome ? `Nome: ${c.nome}` : "", c.id_app ? `ID: ${c.id_app}` : "", c.cpf ? `CPF: ${fmtCPF(c.cpf)}` : "", `Cidade: ${c.cidade}`, c.observacao ? `Obs.: ${c.observacao}` : ""].filter(Boolean).join("\n");
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
      el("b", { text: EVENTO[e.tipo] || e.tipo }), ` por ${e.por_nome} em ${dt(e.em)}`,
      ["enviado", "desfeito", "editado", "revisado"].includes(e.tipo) ? "" : ` → ${ST[e.status_novo]}`,
      (e.tipo === "editado" || e.tipo === "revisado") && e.detalhe ? ` · ${e.detalhe}` : "",
      e.motivo && e.tipo !== "desfeito" ? ` · ${e.motivo}${e.detalhe ? ": " + e.detalhe : ""}` : "")));
  }

  // célula "Entregador" das tabelas: nome, ID, CPF e o botão revisar
  const celEntregador = (c) => el("td", {}, c.nome ? el("div", { text: c.nome }) : null,
    el("span", { class: "mono" + (c.nome ? " meta" : ""), text: c.id_app || "—" }), c.cpf ? el("span", { class: "meta mono", text: " · " + fmtCPF(c.cpf) }) : null,
    c.revisar ? el("div", { onclick: (e) => e.stopPropagation() }, botaoRevisar(c)) : null);
  // botão "revisar": abre a janela para completar os dados (qualquer pessoa da equipe)
  const botaoRevisar = (c, discreto) => el("button", { class: "revisar-cad" + (discreto ? " discreto" : ""), type: "button", title: "Revisar: " + c.revisar,
    onclick: (e) => { e.stopPropagation(); App.abrirCadastro(c.id); } }, discreto ? "revisar" : "⚠ revisar: " + c.revisar);

  // resumo do que o sistema já sabe do ID (ficha, bloqueios, leves, comentários)
  function resumoHistorico(h, idApp) {
    const partes = [];
    if (h.nome) partes.push(`ficha: ${h.nome}${h.cidade ? " · " + h.cidade : ""}`);
    if (h.bloqueios) partes.push(`${h.bloqueios} bloqueio(s)${h.ultimo_infracao ? ` (último: ${h.ultimo_infracao}, ${dt(h.ultimo_em)})` : ""}`);
    if (h.leves) partes.push(`${h.leves} leve(s)`);
    if (h.comentarios) partes.push(`${h.comentarios} comentário(s)`);
    return el("div", { class: "quadrinho" + (h.encerrado ? " grave" : "") },
      h.encerrado ? el("p", { style: "margin:0" }, el("b", { text: "⚠ Este ID está com a parceria encerrada" }), h.encerrado_infracao ? ` (${h.encerrado_infracao}, ${dt(h.encerrado_em)})` : "") : null,
      el("p", { style: "margin:0" }, el("b", { text: "Este ID já existe no Comunique: " }), partes.join(" · ") || "sem registros", h.bloqueado_agora ? " · bloqueado agora" : ""),
      App.abrirFicha ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirFicha(idApp) }, "Consultar entregador") : null);
  }

  // janela para completar ou corrigir um cadastro (aberta pelo botão revisar, pela tarefa ou pela busca)
  App.abrirCadastro = async function abrirCadastro(id) {
    let c;
    try { c = await rpc("ver_cadastro", { p_cadastro: id }); } catch (e) { return toast(msgErro(e)); }
    const campo = (rot, valor, at = {}) => { const i = el("input", { "aria-label": rot, ...at }); i.value = valor || ""; return [el("label", {}, rot, i), i]; };
    const [lNome, iNome] = campo("Nome do entregador", c.nome, { maxlength: "120" });
    const [lId, iId] = campo("ID do entregador", c.id_app, { class: "mono", maxlength: "40", spellcheck: "false" });
    const [lCpf, iCpf] = campo("CPF", c.cpf && fmtCPF(c.cpf), { class: "mono", inputmode: "numeric", maxlength: "14" });
    const [lCid, iCid] = campo("Cidade", c.cidade, { list: "cidades" });
    const iObs = el("textarea", { "aria-label": "Observação", maxlength: "600" }); iObs.value = c.observacao || "";
    const [lMot, iMot] = campo("Motivo da alteração (opcional)", "", { maxlength: "200" });
    iId.addEventListener("input", () => (iId.value = iId.value.replace(/[^A-Za-z0-9]/g, "")));
    iCpf.addEventListener("input", () => (iCpf.value = fmtCPF(iCpf.value)));
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const falhou = (e, btn) => { if (btn) btn.disabled = false; erro.textContent = typeof e === "string" ? e : msgErro(e); erro.hidden = false; };
    const feito = (msg) => { d.close(); toast(msg); delete S.eventos[id]; carregar(); };
    async function salvar(btn) {
      erro.hidden = true;
      const cpf = onlyDigits(iCpf.value), idApp = iId.value.trim(), cidade = iCid.value.trim().replace(/\s+/g, " ").toUpperCase();
      if (!idApp && !cpf) return falhou("O cadastro precisa de um ID ou de um CPF.");
      if (cpf && !cpfValido(cpf)) return falhou("CPF inválido. Confira os 11 números.");
      if (!/^.+ - [A-Z]{2}$/.test(cidade)) return falhou("Use o formato CIDADE - UF, ex.: LAGARTO - SE.");
      btn.disabled = true;
      try {
        const r = await rpc("completar_cadastro", { p_cadastro: id, p_id_app: idApp || null, p_cpf: cpf || null, p_nome: iNome.value.trim() || null,
          p_cidade: cidade, p_observacao: iObs.value.trim() || null, p_motivo: iMot.value.trim() || null });
        feito(r?.revisar ? "Dados salvos. Ainda falta: " + r.revisar + "." : "Dados salvos. O cadastro está completo.");
      } catch (e) { falhou(e, btn); }
    }
    // sugerir tarefa: sem pessoa = administrador + opcional para todos; com pessoa = só para ela
    const selPessoa = el("select", { "aria-label": "Para quem" }, el("option", { value: "", text: "Ninguém em especial (opcional para todos)" }),
      ...S.pessoas.filter((p) => p.id !== S.me.id).map((p) => el("option", { value: p.id, text: p.nome })));
    async function sugerir(btn) {
      btn.disabled = true;
      try { await rpc("sugerir_tarefa_cadastro", { p_cadastro: id, p_para: selPessoa.value || null }); feito("Tarefa sugerida."); }
      catch (e) { falhou(e, btn); }
    }
    const d = App.u.janela(c.revisar ? "Revisar cadastro" : "Editar dados do cadastro",
      el("p", { class: "meta", style: "margin:0", text: `${c.situacao} · enviado por ${c.enviado_por_nome} em ${dt(c.enviado_em)}. Qualquer pessoa da equipe pode completar ou corrigir; o histórico guarda o antes e o depois.` }),
      c.revisar ? el("p", { class: "quadrinho", style: "margin:0" }, el("b", { text: "Revisar: " }), c.revisar) : null,
      lNome, el("div", { class: "grid2" }, lId, lCpf), lCid, el("label", {}, "Observação", iObs), lMot,
      erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => salvar(e.currentTarget) }, "Salvar"),
        c.revisar && c.nome && c.id_app ? el("button", { class: "btn", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await rpc("marcar_cadastro_revisado", { p_cadastro: id }); feito("Marcado como revisado."); } catch (err) { falhou(err, b); } } }, "Os dados estão certos") : null,
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")),
      c.revisar && !c.tarefa_aberta ? el("div", { class: "box" },
        el("p", { class: "meta", style: "margin:0", text: "Não dá para completar agora? Sugira uma tarefa. Sem escolher ninguém, ela vai para o administrador e fica como opcional para toda a equipe." }),
        el("div", { class: "actions" }, selPessoa, el("button", { class: "btn small", type: "button", onclick: (e) => sugerir(e.currentTarget) }, "Sugerir tarefa"))) : null,
      c.revisar && c.tarefa_aberta ? el("p", { class: "meta", style: "margin:0", text: "Já existe uma tarefa aberta para completar este cadastro (ela conclui sozinha quando os dados ficarem completos)." }) : null,
      c.edicoes?.length ? el("details", {}, el("summary", { text: `Alterações anteriores (${c.edicoes.length})` }),
        el("ol", { class: "timeline" }, c.edicoes.map((x) => el("li", {}, el("b", { text: EVENTO[x.tipo] }), ` por ${x.por_nome} em ${dt(x.em)}`, x.detalhe ? ` · ${x.detalhe}` : "")))) : null);
  };

  // ---------- histórico ----------
  function renderHist() {
    const t = $("#t-hist"), l = S.lista.todos;
    const cols = ["Situação", "Entregador", "Cidade", "Enviado por", "Enviado em", "Última decisão", ""];
    const head = el("thead", {}, el("tr", {}, cols.map((h) => el("th", { text: h }))));
    if (!l) return t.replaceChildren(head, el("tbody", {}, el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: "Carregando…" }))));
    opcoesCidade($("#f-hist-cidade"), l);
    // 008c: o Histórico junta o antigo "Meus cadastros" (o suporte já recebe só os dele)
    $("#hist-sub").textContent = staff() ? "Todos os cadastros recebidos. Clique numa linha para ver o histórico de cada um." : "Tudo o que você enviou, com a situação atual. Clique numa linha para ver o histórico.";
    $("#f-hist-meus-box").hidden = !staff();
    const q = $("#q-hist").value, st = $("#f-hist-status").value, cid = $("#f-hist-cidade").value, meus = staff() && $("#f-hist-meus").checked;
    const base = l.filter((c) => !meus || c.enviado_por === S.me.id);
    const cont = (f) => base.filter(f).length;
    const tile = (k, v, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }));
    $("#hist-tiles").replaceChildren(tile(staff() && !meus ? "Cadastros" : "Enviados por você", base.length), tile("Aguardando análise", cont((c) => c.status === "aguardando_analise"), "hl"),
      tile("Aguardando novo contato", cont((c) => c.status === "aguardando_contato"), "hl2"), tile("Aprovados", cont((c) => c.status === "aprovado"), "good"), tile("Encerrados", cont((c) => c.status === "encerrado")));
    const lista = base.filter((c) => busca(c, q) && (!st || (st === "revisar" ? !!c.revisar : c.status === st)) && (!cid || c.cidade === cid)).sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)));
    const body = el("tbody");
    if (!lista.length) body.append(el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: l.length ? "Nenhum cadastro encontrado." : "Você ainda não enviou cadastros." })));
    for (const c of lista) {
      const acoes = el("td", { style: "white-space:nowrap", onclick: (e) => e.stopPropagation() }, botaoHistorico(c.id));
      if (mod()) {
        if (c.pode_desfazer) acoes.append(el("button", { class: "btn link", type: "button", onclick: (e) => desfazer(c, e.currentTarget) }, "Desfazer"));
        if (S.confirmar["x" + c.id]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => excluir(c, e.currentTarget) }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete S.confirmar["x" + c.id]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { S.confirmar["x" + c.id] = true; render(); } }, "Excluir"));
      }
      body.append(el("tr", { class: "clicavel", onclick: () => alternar(c.id) },
        el("td", {}, pill(c.status, true), c.reprovacoes ? el("div", { class: "meta", text: `${c.reprovacoes} reprovação(ões)` }) : null),
        celEntregador(c),
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
    const cols = ["id_entregador", "cpf", "nome", "cidade", "observacao", "situacao", "enviado_por", "enviado_em", "situacao_desde", "decidido_por", "decidido_em", "motivo", "detalhe", "reprovacoes"];
    baixarCSV("cadastros-entregadores", cols, (S.lista.todos || []).slice().sort((a, b) => String(a.enviado_em).localeCompare(String(b.enviado_em))).map((c) =>
      [c.id_app, c.cpf && fmtCPF(c.cpf), c.nome, c.cidade, c.observacao, ST[c.status], c.enviado_por_nome, c.enviado_em, c.status_desde, c.decidido_por_nome, c.decidido_em, c.motivo, c.detalhe, c.reprovacoes]));
  });

  // ---------- aprovados: foram bloqueados depois? (fim do Histórico) ----------
  function renderAprovados() {
    $("#ap-box").hidden = !staff();
    if (!staff()) return;
    const l = S.aprovados, t = $("#t-aprovados");
    const cols = [["Aprovado em"], ["Entregador"], ["Cidade"], ["Enviado por"], ["Bloqueios depois", 1], ["1º bloqueio"], ["Dias até o 1º", 1], ["Agora"]];
    if (!l) { $("#ap-resumo").textContent = "Carregando…"; return t.replaceChildren(...tabela(cols, [], "Carregando…")); }
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
    t.replaceChildren(...tabela(cols, lista.map((x) => el("tr", {},
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
  form.addEventListener("reset", () => setTimeout(() => { ["idapp", "cpf", "cidade"].forEach((k) => ($("#e-" + k).textContent = "")); $("#form-erro").hidden = true; $("#f-historico").replaceChildren(); histChave = ""; }));
  // ao digitar o ID ou o CPF: o que o sistema já sabe (só informa, não impede o envio)
  let histT = null, histChave = "";
  async function verHistorico() {
    const id = $("#f-idapp").value.trim(), cpf = onlyDigits($("#f-cpf").value);
    const chave = (id.length >= 4 ? id.toLowerCase() : "") + "|" + (cpf.length === 11 ? cpf : "");
    if (chave === histChave) return;
    histChave = chave;
    const box = $("#f-historico");
    if (chave === "|") return box.replaceChildren();
    let r;
    try { r = await rpc("historico_id", { p_id_app: id.length >= 4 ? id : null, p_cpf: cpf.length === 11 ? cpf : null }); } catch (_) { return; }
    if (chave !== histChave) return;
    box.replaceChildren(...[
      r.cadastro ? el("div", { class: "quadrinho" }, el("b", { text: `Este ${r.cadastro.por_id ? "ID" : "CPF"} já tem cadastro na ativação: ` }),
        `${r.cadastro.situacao}${r.cadastro.nome ? " · " + r.cadastro.nome : ""}, enviado em ${dt(r.cadastro.enviado_em)}.`) : null,
      r.historico ? resumoHistorico(r.historico, id) : null].filter(Boolean));
  }
  ["#f-idapp", "#f-cpf"].forEach((s) => $(s).addEventListener("input", () => { clearTimeout(histT); histT = setTimeout(verHistorico, 500); }));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = { idApp: $("#f-idapp").value.trim(), nome: $("#f-nome").value.trim(), cpf: $("#f-cpf").value, cidade: $("#f-cidade").value.trim().replace(/\s+/g, " ").toUpperCase(), obs: $("#f-obs").value.trim() };
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
      const r = await rpc("enviar_cadastro", { p_id_app: v.idApp || null, p_cpf: temCpf ? v.cpf : null, p_cidade: v.cidade, p_observacao: v.obs || null, p_nome: v.nome || null });
      // sem id: o cadastro não foi criado (a resposta traz o motivo)
      if (!r.id) {
        const erro = $("#form-erro"); erro.textContent = r.erro; erro.hidden = false;
        return;
      }
      const id = r.id;
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
  ["#q-pend", "#f-pend-status", "#f-pend-cidade", "#q-hist", "#f-hist-status", "#f-hist-cidade", "#f-hist-meus"].forEach((s) => $(s).addEventListener("input", render));

  App.modulo({
    id: "ativacao", nome: "Ativação de entregadores",
    acesso: () => !!S.me?.papel,
    abas: [
      { id: "novo", nome: "Novo cadastro", secao: "v-novo" },
      { id: "pendentes", nome: "Pendentes", secao: "v-pendentes", contador: "c-pend", alerta: true },
      { id: "historico", nome: "Histórico", secao: "v-historico" },
    ],
    padrao: () => "novo",  // 008c: a primeira tela é o cadastro
    async carregar(aba) {
      if (aba === "novo") atualizarCidades();
      const t = [rpc("listar_cadastros", { p_escopo: "pendentes" }).then((d) => (S.lista.pendentes = d))];
      if (aba === "historico") t.push(rpc("listar_cadastros", { p_escopo: "todos" }).then((d) => (S.lista.todos = d)),
                                      staff() ? rpc("aprovados_e_bloqueios").then((d) => (S.aprovados = d)) : null);
      await Promise.all(t);
    },
    render(aba) {
      ({ pendentes: renderPendentes, historico: () => { renderHist(); renderAprovados(); } })[aba]?.();
    },
    contadores() {
      const r = S.resumo?.ativacao;
      if (r) App.contador("c-pend", staff() ? r.aguardando_analise : r.aguardando_analise + r.aguardando_contato);
    },
  });
})();
