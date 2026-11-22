// Módulo "Ativação de entregadores": envio de cadastros, aprovação, painel e histórico.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, onlyDigits, norm, dt, dia, duracao, num, horas, toast, CIDADES, ST, PAPEL, EVENTO, pill, titulo,
          vazio, carregandoEl, rpc, msgErro, tabela, barras, baixarCSV } = App.u;
  const S = App.S;
  Object.assign(S, {
    lista: { pendentes: null, todos: null },
    destaque: null,
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
  const busca = (c, q) => !q || norm([c.id_app, c.nome, c.cidade, c.enviado_por_nome, c.observacao].join(" ")).includes(norm(q));
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
    if (!lista.length) return box.replaceChildren(vazio("Nenhum cadastro com esse filtro", "Limpe a busca ou troque os filtros."),
      el("button", { class: "btn small", type: "button", onclick: () => { $("#q-pend").value = ""; $("#f-pend-status").value = ""; $("#f-pend-cidade").value = ""; render(); } }, "Limpar filtros"));  // 009y2 (A12-12)
    const grupos = ["aguardando_analise", "aguardando_contato"].map((s) => [s, lista.filter((c) => c.status === s)]).filter(([, l]) => l.length);
    // 009y2 (A3-15): no máximo 50 por grupo; "Mostrar mais" traz mais 50
    S.limPend = S.limPend || {};
    box.replaceChildren(...grupos.map(([s, l]) => {
      const lim = S.limPend[s] || 50;
      return el("div", { class: "grupo" },
        el("h3", {}, ST[s], el("span", { class: "count", text: l.length })),
        el("div", { class: "queue linhas-cad" }, l.slice(0, lim).map(card)),
        l.length > lim ? el("button", { class: "btn link mais-pend", type: "button", onclick: () => { S.limPend[s] = lim + 50; render(); } },
          `Mostrar mais ${Math.min(50, l.length - lim)} (de ${l.length})`) : null);
    }));
    if (S.destaque) {
      const n = box.querySelector(`[data-id="${S.destaque}"]`);
      if (n) { App.u.rolar(n, { block: "center" }); setTimeout(() => { S.destaque = null; render(); }, 8000); S.destaque = "_mostrado_" + S.destaque; }
    }
  }

  function card(c) {
    const esp = duracao(c.status_desde);
    const contato = c.status === "aguardando_contato";
    const destacado = S.destaque === c.id || S.destaque === "_mostrado_" + c.id;
    const cx = S.caixa[c.id];
    const prevPassou = c.previsao && new Date(c.previsao) < Date.now();
    // 009z5 (pedido do usuário): uma linha só, sem "Detalhes": nome, situação, só o botão de copiar o ID,
    // cidade · quem enviou · quando, e à direita Editar dados e Encerrar
    const copiarId = !c.id_app ? el("span", { class: "meta", text: "Sem ID" }) : el("button", { class: "btn small", type: "button", "data-copiar-id": c.id_app, title: "ID " + c.id_app, onclick: async (e) => {
      const bt = e.currentTarget;
      try { await navigator.clipboard.writeText(String(c.id_app)); bt.textContent = "ID copiado"; App.uso?.("botao:copiar_id"); } catch (_) { bt.textContent = "Não deu para copiar"; }
      setTimeout(() => { if (bt.isConnected) bt.replaceChildren("Copiar ID", el("span", { class: "so-leitor", text: " " + c.id_app })); }, 1600);
    } }, "Copiar ID", el("span", { class: "so-leitor", text: " " + c.id_app }));  // o ID fica para o leitor de tela e para a busca da página
    return el("article", { class: "card linha-cad" + (contato ? " contato" : "") + (prevPassou ? " previsao-passou" : "") + (destacado ? " destaque" : ""), "data-id": c.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, el("span", { text: c.nome || "Sem nome" }), pill(c.status, true), copiarId,
          destacado ? el("span", { class: "tag", text: "RECÉM-ENVIADO" }) : null, c.revisar ? botaoRevisar(c, true) : null),
        el("span", { class: "espera" + (esp.velho ? " velho" : ""), title: "Desde " + dt(c.status_desde), text: (contato ? "contato há " : "há ") + esp.txt })),
      el("div", { class: "meta linha-cad-info", text: [c.cidade,
        staff() ? (c.enviado_por === S.me.id ? "enviado por você" : c.enviado_por_nome ? "enviado por " + c.enviado_por_nome : null) : null,
        `em ${dt(c.enviado_em)}`, c.previsao ? `Previsão: até ${dt(c.previsao)}` : null].filter(Boolean).join(" · ") }),
      contato ? el("div", { class: "motivo" }, el("b", { text: `Reprovado por ${c.decidido_por_nome} em ${dt(c.decidido_em)}: ` }), c.motivo, c.detalhe ? " — " + c.detalhe : "") : null,
      c.observacao ? el("div", { class: "obs linha-cad-obs", title: c.observacao, text: c.observacao }) : null,  // 009z (pedido do usuário): o comentário aparece sem abrir
      el("div", { class: "actions" },
        staff() ? el("button", { class: "btn approve small", type: "button", onclick: (e) => decidir(c, "aprovar", e.currentTarget) }, "Aprovar") : null,
        staff() && !contato ? el("button", { class: "btn reject small", type: "button", onclick: () => abrir(c.id, "reprovar") }, "Reprovar") : null,
        !staff() ? el("span", { class: "meta", text: contato ? "O responsável vai retomar o contato com o entregador." : "Aguardando análise do responsável." }) : null,
        el("span", { class: "spacer" }),
        el("button", { class: "btn link", type: "button", onclick: () => App.abrirCadastro(c.id) }, "Editar dados"),
        staff() ? el("button", { class: "btn link", type: "button", onclick: () => abrir(c.id, "encerrar") }, "Encerrar") : null),
      cx ? caixa(c, cx) : null);
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
      // 009e: a aprovação conta nas tarefas "Aprovar entregadores" de quem aprovou, na cidade
      const contou = acao === "aprovar" ? await rpc("tarefas_que_contam", { p_tipo: "ativar_entregadores", p_cidade: c.cidade }).catch(() => []) : [];
      toast({ aprovar: "Cadastro aprovado.", reprovar: "Cadastro reprovado: agora aguarda novo contato.", encerrar: "Cadastro encerrado." }[acao] + (App.contouPara?.(contou) || ""));
      // 009y1 (NF-1): depois de aprovar ou reprovar, a mensagem pronta para o entregador fica a um clique
      S.ultimaDecisao = acao === "encerrar" ? null : { c, acao, motivo, detalhe };
      mostrarDecisao();
      await carregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }

  // 009y2: aprovar e reprovar de fora da tela de Pendentes (tira da tela inicial)
  App.decidirCadastro = {
    async aprovar(c, btn, depois) { await decidir(c, "aprovar", btn); depois?.(); },
    reprovar(c, depois) {
      const sel = el("select", { "aria-label": "Motivo da reprovação" }, el("option", { value: "", text: "Escolha o motivo" }),
        ...(S.motivos?.reprovacao || []).map((m) => el("option", { value: m, text: m })));
      const txt = el("input", { placeholder: "Detalhe (obrigatório se escolher Outro)", "aria-label": "Detalhe", maxlength: "300" });
      const d = App.u.janela("Reprovar: " + (c.nome || "ID " + c.id_app),
        el("div", { class: "grid2" }, sel, txt),
        el("div", { class: "actions" },
          el("button", { class: "btn reject", type: "button", onclick: async (e) => { await decidir(c, "reprovar", e.currentTarget, sel.value, txt.value); if (!sel.value) return; d.close(); depois?.(); } }, "Confirmar reprovação"),
          el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
      sel.focus();
    },
  };

  // 009y1 (NF-1): o que o entregador precisa mandar de novo, por motivo de reprovação (os motivos da tabela "motivos")
  const REENVIAR = {
    "Documento ilegível": "Envie de novo a foto do documento, bem iluminada e sem cortes, com todos os dados legíveis.",
    "Documento pendente": "Envie o documento que faltou (frente e verso, quando houver).",
    "Dados divergentes": "Confira o nome e os dados que você informou e envie de novo, iguais aos do documento.",
    "Fotos sem camisa": "Envie uma nova foto de perfil, com camisa, de frente e com o rosto visível.",
    "Documentação bancária com dados insuficientes": "Envie os dados bancários completos: banco, agência, conta e o nome do titular.",
    "Fora da área de atuação": "No momento ainda não atendemos a sua região; avisamos quando chegarmos aí.",
  };
  function mensagemDecisao({ c, acao, motivo, detalhe }) {
    const nome = App.mensagens?.primeiroNome(c.nome) || "";
    if (acao === "aprovar") return App.mensagens?.abrir("ativacao_aprovado", { nome, cidade: c.cidade }, "Mensagem: cadastro aprovado");
    const m = motivo === "Outro" ? String(detalhe || "").trim() : motivo + (detalhe ? ` (${String(detalhe).trim()})` : "");
    return App.mensagens?.abrir("ativacao_reprovado", { nome, cidade: c.cidade, motivo: m, reenviar: motivo === "Outro" ? "" : REENVIAR[motivo] || "" }, "Mensagem: cadastro com pendência");
  }
  function mostrarDecisao() {
    const box = $("#pend-decisao"), d = S.ultimaDecisao;
    if (!box) return;
    box.hidden = !d;
    if (!d) return box.replaceChildren();
    const quem = d.c.nome || (d.c.id_app ? "ID " + d.c.id_app : "o entregador");
    box.replaceChildren(el("span", { text: `${d.acao === "aprovar" ? "Aprovado" : "Reprovado"}: ${quem}.` }),
      el("button", { class: "btn small primary", type: "button", onclick: () => mensagemDecisao(d) }, "Gerar mensagem para o entregador"),
      el("button", { class: "btn link", type: "button", onclick: () => { S.ultimaDecisao = null; mostrarDecisao(); } }, "Fechar"));
  }

  async function copiar(c) {
    const t = [c.nome ? `Nome: ${c.nome}` : "", c.id_app ? `ID: ${c.id_app}` : "", `Cidade: ${c.cidade}`, c.observacao ? `Obs.: ${c.observacao}` : ""].filter(Boolean).join("\n");
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

  // célula "Entregador" das tabelas: nome, ID e o botão revisar
  const celEntregador = (c) => el("td", {}, c.nome ? el("div", { text: c.nome }) : null,
    el("span", { class: "mono" + (c.nome ? " meta" : ""), text: c.id_app || "Sem ID" }),
    c.revisar ? el("div", { onclick: (e) => e.stopPropagation() }, botaoRevisar(c)) : null);
  // botão "revisar": abre a janela para completar os dados (qualquer pessoa da equipe)
  const botaoRevisar = (c, discreto) => el("button", { class: "revisar-cad" + (discreto ? " discreto" : ""), type: "button", title: "Revisar: " + c.revisar,
    onclick: (e) => { e.stopPropagation(); App.abrirCadastro(c.id); } }, discreto ? "revisar" : [App.ic("alerta"), "revisar: " + c.revisar]);

  // 009u (AP-04): a ficha que o próprio cadastro criou (gatilho da 009h) não é "ID que já existe":
  // sem bloqueio, leve, comentário nem encerramento e com o mesmo nome, o quadrinho não aparece
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const soDesteCadastro = (h, c) => !h.bloqueios && !h.leves && !h.comentarios && !h.encerrado && !h.bloqueado_agora
    && (!h.nome || semAcento(h.nome) === semAcento(c.nome));
  // resumo do que o sistema já sabe do ID (ficha, bloqueios, leves, comentários)
  function resumoHistorico(h, idApp) {
    const partes = [];
    if (h.nome) partes.push(`ficha: ${h.nome}${h.cidade ? " · " + h.cidade : ""}`);
    if (h.bloqueios) partes.push(`${App.u.plural(h.bloqueios, "restrição", "restrições")}${h.ultimo_infracao ? ` (a última: ${h.ultimo_infracao}, ${dt(h.ultimo_em)})` : ""}`);
    if (h.leves) partes.push(App.u.plural(h.leves, "leve", "leves"));
    if (h.comentarios) partes.push(App.u.plural(h.comentarios, "comentário", "comentários"));
    return el("div", { class: "quadrinho" + (h.encerrado ? " grave" : "") },
      h.encerrado ? el("p", { style: "margin:0" }, el("b", { icone: "alerta" }, "Este ID está com a parceria encerrada"), h.encerrado_infracao ? ` (${h.encerrado_infracao}, ${dt(h.encerrado_em)})` : "") : null,
      el("p", { style: "margin:0" }, el("b", { text: "Este ID já existe no Comunique: " }), partes.join(" · ") || "sem registros", h.bloqueado_agora ? " · com restrição agora" : ""),
      App.abrirFicha ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirFicha(idApp) }, "Consultar entregador") : null);
  }

  // janela para completar ou corrigir um cadastro (aberta pelo botão revisar, pela tarefa ou pela busca)
  App.abrirCadastro = async function abrirCadastro(id) {
    let c;
    try { c = await rpc("ver_cadastro", { p_cadastro: id }); } catch (e) { return toast(msgErro(e)); }
    const campo = (rot, valor, at = {}) => { const i = el("input", { "aria-label": rot, ...at }); i.value = valor || ""; return [el("label", {}, rot, i), i]; };
    const [lNome, iNome] = campo("Nome do entregador", c.nome, { maxlength: "120" });
    const [lId, iId] = campo("ID do entregador", c.id_app, { class: "mono", maxlength: "40", spellcheck: "false" });
    const [lCid, iCid] = campo("Cidade", c.cidade, { list: "cidades" });
    const iObs = el("textarea", { "aria-label": "Observação", maxlength: "600" }); iObs.value = c.observacao || "";
    const [lMot, iMot] = campo("Motivo da alteração (opcional)", "", { maxlength: "200" });
    iId.addEventListener("input", () => (iId.value = iId.value.replace(/[^A-Za-z0-9]/g, "")));
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const falhou = (e, btn) => { if (btn) btn.disabled = false; erro.textContent = typeof e === "string" ? e : msgErro(e); erro.hidden = false; };
    const feito = (msg) => { d.close(); toast(msg); delete S.eventos[id]; carregar(); };
    async function salvar(btn) {
      erro.hidden = true;
      const idApp = iId.value.trim(), cidade = iCid.value.trim().replace(/\s+/g, " ").toUpperCase();
      if (!idApp) return falhou("O cadastro precisa do ID do entregador.");
      if (!/^.+ - [A-Z]{2}$/.test(cidade)) return falhou("Use o formato CIDADE - UF, ex.: LAGARTO - SE.");
      btn.disabled = true;
      try {
        const r = await rpc("completar_cadastro", { p_cadastro: id, p_id_app: idApp || null, p_cpf: null, p_nome: iNome.value.trim() || null,
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
      lNome, lId, lCid, el("label", {}, "Observação", iObs), lMot,
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
  // 009x (AT4): a busca e os filtros rodam no banco, que devolve só a página da tela (100 por vez) e as contagens.
  const POR_HIST = 100;
  let histPag = 1, pagChave = null, pagT = null;
  function argsHist(por = POR_HIST, pagina = histPag) {
    return { p_pagina: pagina, p_por: por, p_busca: $("#q-hist").value.trim() || null, p_status: $("#f-hist-status").value || null,
      p_cidade: $("#f-hist-cidade").value || null, p_meus: $("#f-hist-meus").checked };
  }
  const chaveDoHist = () => { const a = argsHist(); delete a.p_pagina; return JSON.stringify(a); };
  const pedirHist = (a) => rpc("listar_cadastros_pagina", a);  // 009z (A7-15): sem o caminho do banco antigo
  async function carregarHist() {
    const chave = chaveDoHist();
    if (pagChave !== chave) { pagChave = chave; histPag = 1; }
    const d = await pedirHist(argsHist());
    if (chave === chaveDoHist()) S.lista.hist = d;
  }
  // A3-04: espera a pessoa parar de digitar e busca de novo (o redesenho é só da lista, quando os dados chegam)
  // PB-11: busca e troca de página pedem só a página nova e redesenham só a tabela (sem recarregar o app inteiro)
  async function atualizarHist() {
    try { await carregarHist(); } catch (e) { return toast(msgErro(e)); }
    renderHist();
  }
  const filtrarHist = () => { clearTimeout(pagT); pagT = setTimeout(atualizarHist, 300); };
  function renderHist() {
    const t = $("#t-hist"), h = S.lista.hist;
    const cols = ["Situação", "Entregador", "Cidade", "Enviado por", "Enviado em", "Última decisão", ""];
    const head = el("thead", {}, el("tr", {}, cols.map((x) => el("th", { text: x }))));
    if (!h) { $("#hist-total").textContent = ""; return t.replaceChildren(head, el("tbody", {}, App.u.linhasEsqueleto(cols.length))); }
    opcoesCidade($("#f-hist-cidade"), h.cidades.map((cidade) => ({ cidade })));
    // 008c: o Histórico junta o antigo "Meus cadastros" (o suporte já recebe só os dele)
    $("#hist-sub").textContent = "Todos os cadastros recebidos. Clique numa linha para ver o histórico de cada um.";  // 009x6: o suporte também vê todos
    $("#f-hist-meus-box").hidden = false;  // 009x6: o suporte também vê todos e pode filtrar os seus
    const meus = $("#f-hist-meus").checked, k = h.contagens;
    // 009y2 (AP-11): os quadrinhos viram uma barra de filtros com a contagem; clicar filtra pela situação
    const stAtual = $("#f-hist-status").value;
    const tile = (rot, v, st, cls = "") => el("button", { type: "button", class: "tile clicavel " + cls + (stAtual === st ? " ativo" : ""), "aria-pressed": String(stAtual === st),
      title: st ? "Filtrar: " + rot : "Tirar o filtro de situação", onclick: () => { $("#f-hist-status").value = stAtual === st ? "" : st; filtrarHist(); } },
      el("span", { class: "k", text: rot }), el("span", { class: "v", text: v }));
    $("#hist-tiles").replaceChildren(tile(staff() && !meus ? "Cadastros" : "Enviados por você", k.cadastros, ""), tile("Aguardando análise", k.aguardando_analise, "aguardando_analise", "hl"),
      tile("Aguardando novo contato", k.aguardando_contato, "aguardando_contato", "hl2"), tile("Aprovados", k.aprovado, "aprovado", "good"), tile("Encerrados", k.encerrado, "encerrado"));
    const paginas = Math.max(1, Math.ceil(h.total / h.por)), ini = (h.pagina - 1) * h.por;
    $("#hist-total").textContent = h.total === k.cadastros ? App.u.plural(h.total, "cadastro", "cadastros") + (paginas > 1 ? ` · mostrando ${ini + 1} a ${Math.min(ini + h.por, h.total)}` : "")
      : `${h.total} de ${App.u.plural(k.cadastros, "cadastro", "cadastros")}` + (paginas > 1 ? ` · mostrando ${ini + 1} a ${Math.min(ini + h.por, h.total)}` : "");
    const body = el("tbody");
    if (!h.itens.length) body.append(el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: k.cadastros ? "Nenhum cadastro encontrado." : "Você ainda não enviou cadastros." })));
    for (const c of h.itens) {
      const acoes = el("td", { style: "white-space:nowrap", onclick: (e) => e.stopPropagation() }, botaoHistorico(c.id));
      if (mod()) {
        if (c.pode_desfazer) acoes.append(el("button", { class: "btn link", type: "button", onclick: (e) => desfazer(c, e.currentTarget) }, "Desfazer"));
        if (S.confirmar["x" + c.id]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => excluir(c, e.currentTarget) }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete S.confirmar["x" + c.id]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { S.confirmar["x" + c.id] = true; render(); } }, "Excluir"));
      }
      body.append(el("tr", { class: "clicavel", onclick: () => alternar(c.id) },
        el("td", {}, pill(c.status, true), c.reprovacoes ? el("div", { class: "meta", text: App.u.plural(c.reprovacoes, "reprovação", "reprovações") }) : null),
        celEntregador(c),
        el("td", { text: c.cidade }), el("td", { text: c.enviado_por === S.me.id ? "Você" : c.enviado_por_nome }), el("td", { text: dt(c.enviado_em) }),
        el("td", { class: "meta", text: c.decidido_em ? `${dt(c.decidido_em)} por ${c.decidido_por_nome}${c.motivo ? ` · ${c.motivo}${c.detalhe ? ": " + c.detalhe : ""}` : ""}` : "—" }),
        acoes));
      if (S.abertos.has(c.id)) body.append(el("tr", {}, el("td", { colspan: cols.length }, timeline(c.id))));
    }
    t.replaceChildren(head, body);
    const ir = (n) => { histPag = n; atualizarHist(); App.u.rolar?.($("#t-hist")); };
    $("#hist-paginas").replaceChildren(...(paginas > 1 ? [
      el("button", { class: "btn small", type: "button", disabled: h.pagina === 1, onclick: () => ir(h.pagina - 1) }, "‹ Anterior"),
      el("span", { text: `Página ${h.pagina} de ${paginas}` }),
      el("button", { class: "btn small", type: "button", disabled: h.pagina === paginas, onclick: () => ir(h.pagina + 1) }, "Próxima ›")] : []));
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
  $("#b-export").addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    let itens;   // 009x: o CSV pede tudo de uma vez (com os filtros da tela), até 5.000
    try { itens = (await pedirHist(argsHist(5000, 1))).itens; } catch (err) { btn.disabled = false; return toast(msgErro(err)); }
    btn.disabled = false;
    const cols = ["id_entregador", "nome", "cidade", "observacao", "situacao", "enviado_por", "enviado_em", "situacao_desde", "decidido_por", "decidido_em", "motivo", "detalhe", "reprovacoes"];
    baixarCSV("cadastros-entregadores", cols, itens.slice().sort((a, b) => String(a.enviado_em).localeCompare(String(b.enviado_em))).map((c) =>
      [c.id_app, c.nome, c.cidade, c.observacao, ST[c.status], c.enviado_por_nome, c.enviado_em, c.status_desde, c.decidido_por_nome, c.decidido_em, c.motivo, c.detalhe, c.reprovacoes]));
  });


  // ---------- novo cadastro ----------
  const form = $("#form");
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
  form.addEventListener("reset", () => setTimeout(() => { ["idapp", "cidade"].forEach((k) => ($("#e-" + k).textContent = "")); $("#form-erro").hidden = true; $("#f-historico").replaceChildren(); histChave = ""; }));
  // ao digitar o ID: o que o sistema já sabe (só informa, não impede o envio)
  let histT = null, histChave = "";
  async function verHistorico() {
    const id = $("#f-idapp").value.trim();
    const chave = id.length >= 4 ? id.toLowerCase() : "";
    if (chave === histChave) return;
    histChave = chave;
    const box = $("#f-historico");
    if (!chave) return box.replaceChildren();
    let r;
    try { r = await rpc("historico_id", { p_id_app: id.length >= 4 ? id : null, p_cpf: null }); } catch (_) { return; }
    if (chave !== histChave) return;
    box.replaceChildren(...[
      r.cadastro ? el("div", { class: "quadrinho" }, el("b", { text: "Este ID já tem cadastro na ativação: " }),
        `${r.cadastro.situacao}${r.cadastro.nome ? " · " + r.cadastro.nome : ""}, enviado em ${dt(r.cadastro.enviado_em)}.`) : null,
      r.historico ? resumoHistorico(r.historico, id) : null].filter(Boolean));
  }
  ["#f-idapp"].forEach((s) => $(s).addEventListener("input", () => { clearTimeout(histT); histT = setTimeout(verHistorico, 500); }));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = { idApp: $("#f-idapp").value.trim(), nome: $("#f-nome").value.trim(), cidade: $("#f-cidade").value.trim().replace(/\s+/g, " ").toUpperCase(), obs: $("#f-obs").value.trim() };
    const temId = !!v.idApp;
    const errs = {
      idapp: !temId ? "Preencha o ID do entregador." : temId && v.idApp.length < 4 ? "ID muito curto. Confira." : "",
      cidade: !/^.+ - [A-Z]{2}$/.test(v.cidade) ? "Use o formato CIDADE - UF, ex.: LAGARTO - SE." : "",
    };
    for (const k in errs) $("#e-" + k).textContent = errs[k];
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) return $("#f-" + first).focus();
    const btn = $("#b-enviar"); btn.disabled = true;
    try {
      const r = await rpc("enviar_cadastro", { p_id_app: v.idApp || null, p_cpf: null, p_cidade: v.cidade, p_observacao: v.obs || null, p_nome: v.nome || null });
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
  ["#q-pend", "#f-pend-status", "#f-pend-cidade"].forEach((s) => $(s).addEventListener("input", render));
  ["#q-hist", "#f-hist-status", "#f-hist-cidade", "#f-hist-meus"].forEach((s) => $(s).addEventListener("input", filtrarHist));

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
      const t = [rpc("listar_cadastros", { p_escopo: "pendentes" }).then((d) => (S.lista.pendentes = staff() ? d : d.filter((c) => c.enviado_por === S.me.id)))];
      if (aba === "historico") t.push(carregarHist());
      await Promise.all(t);
    },
    render(aba) {
      ({ pendentes: renderPendentes, historico: renderHist })[aba]?.();
    },
    contadores() {
      const r = S.resumo?.ativacao;
      if (r) App.contador("c-pend", staff() ? r.aguardando_analise : r.aguardando_analise + r.aguardando_contato);
    },
  });
})();
