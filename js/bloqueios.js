// Módulo "Bloqueios": registro com cálculo automático da punição, tratativas, painel, histórico e regras.
// As regras (ocorrência, horas, encerramento de parceria, tratativa) são calculadas no banco
// (supabase/002-bloqueios.sql); esta tela só mostra e chama as funções.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, norm, dt, dia, duracao, horas, toast, PAPEL, vazio, carregandoEl, rpc, msgErro,
          tabela, barras, grafico, baixarCSV, filtroPessoas, caixaPessoas, nomesEscolhidos } = App.u;
  const S = App.S;
  const B = {
    regras: null, lista: { ativos: null, meus: null, todos: null }, tarefas: { pendente: null, concluida: null },
    metricas: null, previa: null, resultado: null, consulta: null, destaque: null,
    painel: { periodo: 30, filtro: "todos", escolhidos: new Set(), cidade: "", infracao: "" },
    tratVer: "pendente", caixa: {}, eventos: {}, confirmar: {},
  };
  const papel = () => S.me?.papel_bloqueios;
  const staff = () => ["moderador", "monitorador"].includes(papel());
  const mod = () => papel() === "moderador";
  const render = () => App.render();
  const carregar = () => App.carregar();

  const SIT = { bloqueado: "Bloqueado", liberado: "Liberado", liberado_antes: "Liberado antes do prazo", encerramento: "Parceria encerrada" };
  const pillSit = (s) => el("span", { class: "pill " + s, text: SIT[s] });
  const horasTxt = (h) => h == null ? "Encerramento de parceria" : h % 24 === 0 && h >= 48 ? `${h / 24} dias (${h} h)` : `${h} h`;
  const ord = (n) => `${n}ª`;
  function falta(iso) {
    const min = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 48) return m && h < 10 ? `${h} h ${m} min` : `${h} h`;
    return `${Math.round(h / 24)} dias`;
  }
  const infracoes = () => (B.regras?.infracoes || []);
  const cidadesAtivas = () => (B.regras?.cidades || []).filter((c) => c.ativa);
  const respDaCidade = (nome) => { const c = (B.regras?.cidades || []).find((x) => x.nome === nome); return c?.responsavel_valido ? c.responsavel_nome : "Moderadores"; };
  const buscaB = (b, q) => !q || norm([b.id_app, b.nome, b.cidade, b.infracao, b.registrado_por_nome, b.tarefa?.responsavel_nome].join(" ")).includes(norm(q));
  function preencher(sel, opcoes, primeiro) {
    const cur = sel.value, sig = opcoes.map(([v]) => v).join("|");
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    sel.replaceChildren(el("option", { value: "", text: primeiro }), ...opcoes.map(([v, t]) => el("option", { value: v, text: t })));
    sel.value = opcoes.some(([v]) => String(v) === cur) ? cur : "";
  }
  const opcCidades = (lista) => [...new Set(lista.map((b) => b.cidade).filter(Boolean))].sort().map((c) => [c, c]);
  const opcInfracoes = () => infracoes().map((i) => [String(i.id), i.nome]);

  // ---------- cartão de um bloqueio (tratativas, bloqueados agora, meus registros) ----------
  function bulletTratativa(b) {
    const t = b.tarefa;
    if (!t) return el("div", { class: "bullet sem", text: "Sem tratativa: bloqueio de menos de 10 h." });
    const tipo = t.tipo === "encerramento_parceria" ? "Encerramento de parceria" : "Tratativa";
    if (t.status === "pendente") return el("div", { class: "bullet pendente" }, el("span", {}, el("b", { text: `${tipo} pendente` }), ` com ${t.responsavel_nome} · há ${duracao(t.criada_em).txt}`));
    return el("div", { class: "bullet concluida" }, el("span", {},
      el("b", { text: `${tipo} realizada` }),
      t.importada ? " (registro importado da planilha)" : ` por ${t.concluida_por_nome} em ${dt(t.concluida_em)}`,
      t.nota ? ` — ${t.nota}` : ""));
  }
  function cardBloqueio(b, { acoes = true } = {}) {
    const sit = b.situacao;
    const cx = B.caixa[b.id];
    const tarefaMinha = staff() && b.tarefa?.status === "pendente" && (mod() || b.tarefa.responsavel_email === S.me.email);
    const destacado = B.destaque === b.id;
    const classe = "card " + (sit === "encerramento" ? "encerramento" : b.tarefa?.status === "concluida" ? "tratada" : "bq") + (destacado ? " destaque" : "");
    return el("article", { class: classe, "data-id": b.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, b.nome, el("span", { class: "mono meta", text: b.id_app }), pillSit(sit), destacado ? el("span", { class: "tag", text: "RECÉM-REGISTRADO" }) : null),
        el("span", { class: "espera" + (sit === "bloqueado" ? "" : " velho"), text: sit === "bloqueado" ? `libera em ${falta(b.fim)}` : sit === "encerramento" ? "definitivo" : "" })),
      el("dl", { class: "fields" },
        fld("Infração", b.infracao),
        fld("Ocorrência", b.ocorrencia < b.ocorrencia_total ? `${ord(b.ocorrencia)} para a punição (${ord(b.ocorrencia_total)} no histórico)` : ord(b.ocorrencia)),
        fld("Punição", horasTxt(b.horas)),
        fld("Início", dt(b.inicio)),
        fld("Fim", b.fim ? dt(b.fim) : "—"),
        fld("Cidade", b.cidade),
        fld("Registrado por", b.registrado_por === S.me.id ? "Você" : b.registrado_por_nome)),
      b.revisar ? el("span", { class: "alerta-revisar", text: "Revisar: " + b.revisar }) : null,
      b.observacao ? el("div", { class: "obs", text: b.observacao }) : null,
      sit === "liberado_antes" ? el("div", { class: "obs" }, el("b", { text: `Liberado antes do prazo por ${b.liberado_por_nome} em ${dt(b.liberado_em)}: ` }), b.motivo_liberacao) : null,
      bulletTratativa(b),
      acoes ? el("div", { class: "actions" },
        tarefaMinha ? el("button", { class: "btn approve", type: "button", onclick: () => abrir(b.id, "tratar") }, b.tarefa.tipo === "encerramento_parceria" ? "Marcar encerramento como tratado" : "Marcar tratativa como resolvida") : null,
        botaoEventos(b.id),
        el("span", { class: "spacer" }),
        staff() && (sit === "bloqueado" || sit === "encerramento") ? el("button", { class: "btn quiet small", type: "button", onclick: () => abrir(b.id, "liberar") }, "Liberar antes do prazo…") : null) : null,
      cx ? caixa(b, cx) : null,
      B.eventos[b.id + ":aberto"] ? linhaDoTempo(b.id) : null);
  }
  const fld = (k, v) => el("div", {}, el("dt", { text: k }), el("dd", { text: v || "—" }));
  function abrir(id, acao) { B.caixa[id] = B.caixa[id]?.acao === acao ? undefined : { acao, texto: "" }; render(); }
  function caixa(b, cx) {
    const tratar = cx.acao === "tratar";
    const txt = el("textarea", { maxlength: "600", rows: "2", placeholder: tratar ? "O que foi feito? (opcional) Ex.: entregador orientado por telefone." : "Motivo da liberação (obrigatório)", "aria-label": tratar ? "Nota da tratativa" : "Motivo da liberação", oninput: (e) => (cx.texto = e.target.value) });
    txt.value = cx.texto;
    return el("div", { class: "box" + (tratar ? "" : " encerrar") },
      el("p", { class: "meta", style: "margin:0", text: tratar
        ? "Marcar como resolvida NÃO libera o bloqueio: ele continua até o fim do prazo. Quem registrou recebe um aviso."
        : "O entregador volta a poder trabalhar agora. Quem registrou recebe um aviso com o motivo." }),
      txt,
      el("div", { class: "actions" },
        el("button", { class: tratar ? "btn approve small" : "btn danger small", type: "button", onclick: (e) => (tratar ? concluir(b.tarefa.id, cx.texto, e.currentTarget, b.id) : liberar(b, cx.texto, e.currentTarget)) }, tratar ? "Confirmar" : "Confirmar liberação"),
        el("button", { class: "btn link", type: "button", onclick: () => { delete B.caixa[b.id]; render(); } }, "Cancelar")));
  }
  async function concluir(tarefaId, nota, btn, bloqueioId) {
    btn.disabled = true;
    try {
      await rpc("concluir_tratativa", { p_tarefa: tarefaId, p_nota: nota || null });
      if (bloqueioId) delete B.caixa[bloqueioId];
      toast("Tratativa registrada. O bloqueio continua até o fim do prazo.");
      await carregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function liberar(b, motivo, btn) {
    if (!String(motivo || "").trim()) return toast("Informe o motivo da liberação.");
    btn.disabled = true;
    try { await rpc("liberar_bloqueio", { p_bloqueio: b.id, p_motivo: motivo }); delete B.caixa[b.id]; toast(`${b.nome} foi liberado.`); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  // linha do tempo: registro, tratativa e liberação vêm do próprio objeto
  function botaoEventos(id) {
    const k = id + ":aberto";
    return el("button", { class: "btn link", type: "button", onclick: (e) => { e.stopPropagation(); B.eventos[k] = !B.eventos[k]; render(); } }, B.eventos[k] ? "Ocultar histórico do entregador" : "Ver histórico do entregador");
  }
  function linhaDoTempo(id) {
    const b = todosConhecidos().find((x) => x.id === id);
    const outros = todosConhecidos().filter((x) => b && x.id_app.toLowerCase() === b.id_app.toLowerCase()).sort((x, y) => String(y.inicio).localeCompare(String(x.inicio)));
    if (!outros.length) return el("p", { class: "meta", text: "Sem outros registros." });
    return el("ol", { class: "timeline" }, outros.map((x) => el("li", {},
      el("b", { text: dt(x.inicio) }), ` · ${x.infracao} · ${ord(x.ocorrencia)} · ${horasTxt(x.horas)} · ${SIT[x.situacao]}`,
      x.nome !== b.nome ? el("span", { class: "alerta-revisar", text: ` nome registrado: ${x.nome}` }) : null)));
  }
  const todosConhecidos = () => {
    const m = new Map();
    for (const l of [B.lista.todos, B.lista.ativos, B.lista.meus, (B.tarefas.pendente || []).map((t) => t.bloqueio), (B.tarefas.concluida || []).map((t) => t.bloqueio)])
      for (const b of l || []) m.set(b.id, b);
    return [...m.values()];
  };

  // ---------- tratativas ----------
  function renderTratativas() {
    document.querySelectorAll("[data-trat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.trat === B.tratVer)));
    const l = B.tarefas[B.tratVer];
    const box = $("#bq-trat-lista");
    $("#bq-trat-sub").textContent = mod()
      ? "Bloqueios de 10 h ou mais e encerramentos de parceria de todas as cidades. Resolver a tratativa não libera o bloqueio."
      : "Bloqueios de 10 h ou mais e encerramentos de parceria das suas cidades. Resolver a tratativa não libera o bloqueio.";
    if (!l) return box.replaceChildren(carregandoEl());
    preencher($("#bq-trat-cidade"), opcCidades(l.map((t) => t.bloqueio)), "Todas as cidades");
    const q = $("#bq-q-trat").value, cid = $("#bq-trat-cidade").value;
    const lista = l.filter((t) => buscaB(t.bloqueio, q) && (!cid || t.bloqueio.cidade === cid));
    if (B.tratVer === "concluida") lista.sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em)));
    if (!l.length) return box.replaceChildren(vazio(B.tratVer === "pendente" ? "Nenhuma tratativa pendente" : "Nenhuma tratativa concluída ainda", B.tratVer === "pendente" ? "Quando um bloqueio de 10 h ou mais for registrado nas suas cidades, ele aparece aqui." : ""));
    if (!lista.length) return box.replaceChildren(vazio("Nada com esse filtro", "Limpe a busca ou troque a cidade."));
    const enc = lista.filter((t) => t.tipo === "encerramento_parceria"), trat = lista.filter((t) => t.tipo === "tratativa");
    box.replaceChildren(...[["Encerramentos de parceria", enc], ["Tratativas de bloqueio", trat]].filter(([, x]) => x.length).map(([tit, x]) =>
      el("div", { class: "grupo" }, el("h3", {}, tit, el("span", { class: "count", text: x.length })), el("div", { class: "queue" }, x.map((t) => cardBloqueio(t.bloqueio))))));
  }

  // ---------- bloqueados agora ----------
  function renderAtivos() {
    const l = B.lista.ativos, box = $("#bq-ativos-lista");
    if (!l) return box.replaceChildren(carregandoEl());
    preencher($("#bq-ativos-cidade"), opcCidades(l), "Todas as cidades");
    preencher($("#bq-ativos-inf"), opcInfracoes(), "Todas as infrações");
    const q = $("#bq-q-ativos").value, cid = $("#bq-ativos-cidade").value, inf = $("#bq-ativos-inf").value;
    const lista = l.filter((b) => buscaB(b, q) && (!cid || b.cidade === cid) && (!inf || String(b.infracao_id) === inf))
      .sort((a, b) => (a.fim ? 0 : 1) - (b.fim ? 0 : 1) || String(a.fim || a.inicio).localeCompare(String(b.fim || b.inicio)));
    if (!l.length) return box.replaceChildren(vazio("Ninguém bloqueado agora", ""));
    if (!lista.length) return box.replaceChildren(vazio("Nada com esse filtro", ""));
    box.replaceChildren(el("div", { class: "queue" }, lista.map((b) => cardBloqueio(b))));
  }

  // ---------- meus registros ----------
  function renderMeus() {
    const l = B.lista.meus;
    const cont = (f) => (l || []).filter(f).length;
    const tile = (k, v, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: l ? v : "…" }));
    $("#bq-meus-tiles").replaceChildren(
      tile("Registrados por você", cont(() => true)),
      tile("Bloqueados agora", cont((b) => b.situacao === "bloqueado"), "hl2"),
      tile("Tratativas em andamento", cont((b) => b.tarefa?.status === "pendente"), "hl"),
      tile("Tratativas realizadas", cont((b) => b.tarefa?.status === "concluida"), "good"),
      tile("Encerramentos de parceria", cont((b) => b.situacao === "encerramento")));
    const box = $("#bq-meus-lista");
    if (!l) return box.replaceChildren(carregandoEl());
    preencher($("#bq-meus-inf"), opcInfracoes(), "Todas as infrações");
    const q = $("#bq-q-meus").value, sit = $("#bq-meus-sit").value, inf = $("#bq-meus-inf").value;
    const lista = l.filter((b) => buscaB(b, q) && (!inf || String(b.infracao_id) === inf) &&
      (!sit || (sit === "tratativa_pendente" ? b.tarefa?.status === "pendente" : sit === "tratativa_feita" ? b.tarefa?.status === "concluida" : b.situacao === sit)));
    if (!l.length) return box.replaceChildren(vazio("Você ainda não registrou bloqueios", "Os bloqueios que você registrar aparecem aqui, com o andamento da tratativa."));
    if (!lista.length) return box.replaceChildren(vazio("Nada com esse filtro", ""));
    box.replaceChildren(el("div", { class: "queue" }, lista.map((b) => cardBloqueio(b))));
    if (B.destaque) {
      const n = box.querySelector(`[data-id="${B.destaque}"]`);
      if (n) { n.scrollIntoView({ block: "center", behavior: "smooth" }); const id = B.destaque; setTimeout(() => { if (B.destaque === id) { B.destaque = null; render(); } }, 8000); }
    }
  }

  // ---------- novo bloqueio ----------
  let tPrevia = null, seqPrevia = 0;
  function pedirPrevia() {
    clearTimeout(tPrevia);
    tPrevia = setTimeout(async () => {
      const id = $("#bq-id").value.trim(), inf = $("#bq-infracao").value;
      const minha = ++seqPrevia;
      if (id.length < 4) { B.previa = null; return renderNovo(); }
      try {
        const p = await rpc("previa_bloqueio", { p_id_app: id, p_infracao: inf ? Number(inf) : null });
        if (minha !== seqPrevia) return;
        B.previa = { ...p, id, inf };
        // sugere o nome já usado para este ID
        if (!$("#bq-nome").value.trim() && p.historico[0]?.nome) $("#bq-nome").value = p.historico[0].nome;
        if (!$("#bq-cidade").value && p.historico[0]?.cidade) $("#bq-cidade").value = p.historico[0].cidade;
      } catch (e) { B.previa = { erro: msgErro(e) }; }
      renderNovo();
    }, 350);
  }
  function renderNovo() {
    preencher($("#bq-cidade"), cidadesAtivas().map((c) => [c.nome, c.nome]), "Escolha a cidade");
    preencher($("#bq-infracao"), infracoes().filter((i) => i.ativa).map((i) => [String(i.id), i.nome]), "Escolha a infração");
    const box = $("#bq-previa"), p = B.previa;
    const id = $("#bq-id").value.trim(), inf = $("#bq-infracao").value;
    if (B.resultado) { box.replaceChildren(resultado(B.resultado)); return; }
    if (!p || id.length < 4) return box.replaceChildren(el("p", { class: "meta", text: "Digite o ID do entregador e escolha a infração para ver a punição antes de registrar." }));
    if (p.erro) return box.replaceChildren(el("p", { class: "err", text: p.erro }));
    const partes = [];
    if (inf && p.ocorrencia) {
      const infNome = infracoes().find((i) => String(i.id) === inf)?.nome;
      partes.push(el("div", { class: "previa" + (p.encerramento ? " encerra" : "") },
        el("div", { class: "meta", text: `${ord(p.ocorrencia)} ocorrência de “${infNome}”` + (p.reiniciada ? ` · contagem zerada: mais de ${p.janela_dias} dias sem esta infração (${ord(p.total)} no histórico)` : "") }),
        el("div", { class: "grande", text: p.encerramento ? "Encerramento de parceria" : `Aplicar ${horasTxt(p.horas)} de bloqueio` }),
        !p.encerramento ? el("div", { text: `Se registrar agora, o bloqueio termina em ${dt(new Date(Date.now() + p.horas * 3600000).toISOString())} e é retirado automaticamente.` }) : el("div", { text: "Bloqueio definitivo: o entregador não volta à operação." }),
        el("div", { class: "meta", text: p.gera_tratativa ? `Gera ${p.encerramento ? "tarefa de encerramento de parceria" : "tratativa"} para ${respDaCidade($("#bq-cidade").value)}.` : "Bloqueio curto: não gera tratativa." })));
    }
    const hist = p.historico || [];
    const nomeDigitado = norm($("#bq-nome").value.trim());
    partes.push(el("div", { class: "panel", style: "margin:0" },
      el("h3", { text: hist.length ? `Histórico deste ID (${hist.length} bloqueio(s))` : "Este ID não tem bloqueios anteriores" }),
      p.cadastro ? el("p", { class: "meta", text: `Cadastro na ativação: ${p.cadastro.situacao} (enviado em ${dt(p.cadastro.enviado_em)}, ${p.cadastro.cidade}).` }) : el("p", { class: "meta", text: "Sem cadastro no módulo de ativação." }),
      hist.length ? el("ol", { class: "timeline" }, hist.slice(0, 12).map((h) => el("li", {},
        el("b", { text: dt(h.inicio) }), ` · ${h.infracao} · ${ord(h.ocorrencia)} · ${horasTxt(h.horas)} · ${SIT[h.situacao]} · por ${h.registrado_por_nome}`,
        nomeDigitado && norm(h.nome) !== nomeDigitado ? el("span", { class: "alerta-revisar", text: ` registrado como “${h.nome}”` }) : null))) : null));
    box.replaceChildren(...partes);
  }
  function resultado(r) {
    return el("div", { class: "previa" + (r.horas == null ? " encerra" : "") },
      el("div", { class: "meta", text: `Bloqueio registrado: ${r.nome} · ${ord(r.ocorrencia)} ocorrência de “${r.infracao}”` }),
      el("div", { class: "grande", text: r.horas == null ? "Encerramento de parceria registrado" : `Aplique ${horasTxt(r.horas)} de bloqueio` }),
      r.fim ? el("div", { text: `Até ${dt(r.fim)}. O sistema retira o bloqueio sozinho nesse horário.` }) : null,
      el("div", { class: "meta", text: r.tarefa ? `Tratativa enviada para ${r.responsavel}. Você recebe um aviso quando ela for feita.` : "Bloqueio curto: sem tratativa." }),
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: () => { B.resultado = null; B.previa = null; renderNovo(); $("#bq-id").focus(); } }, "Registrar outro"),
        el("a", { class: "btn", href: "#bloqueios/meus", onclick: () => { B.destaque = r.id; B.resultado = null; } }, "Ver em Meus registros")));
  }
  $("#bq-id").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, ""); B.resultado = null; pedirPrevia(); });
  $("#bq-infracao").addEventListener("change", () => { B.resultado = null; pedirPrevia(); });
  $("#bq-cidade").addEventListener("change", () => renderNovo());
  $("#bq-nome").addEventListener("change", () => renderNovo());
  $("#bq-form").addEventListener("input", () => ($("#bq-erro").hidden = true));
  $("#bq-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = { id: $("#bq-id").value.trim(), nome: $("#bq-nome").value.trim(), cidade: $("#bq-cidade").value, inf: $("#bq-infracao").value, obs: $("#bq-obs").value.trim() };
    const erro = v.id.length < 4 ? "Preencha o ID do entregador." : !v.nome ? "Preencha o nome do entregador." : !v.cidade ? "Escolha a cidade." : !v.inf ? "Escolha a infração." : "";
    if (erro) { $("#bq-erro").textContent = erro; $("#bq-erro").hidden = false; return; }
    const btn = $("#bq-enviar"); btn.disabled = true;
    try {
      const r = await rpc("registrar_bloqueio", { p_id_app: v.id, p_nome: v.nome, p_cidade: v.cidade, p_infracao: Number(v.inf), p_observacao: v.obs || null });
      B.resultado = { ...r, nome: v.nome, infracao: infracoes().find((i) => String(i.id) === v.inf)?.nome, responsavel: respDaCidade(v.cidade) };
      const cidade = v.cidade;
      $("#bq-form").reset(); $("#bq-cidade").value = cidade;
      B.previa = null;
      toast(r.horas == null ? "Encerramento de parceria registrado." : `Bloqueio registrado: aplique ${horasTxt(r.horas)}.`);
      renderNovo();
      carregar();
    } catch (e) { $("#bq-erro").textContent = msgErro(e); $("#bq-erro").hidden = false; }
    finally { btn.disabled = false; }
  });

  // ---------- consultar entregador ----------
  $("#bq-f-consulta").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = $("#bq-q-consulta").value.trim();
    B.consulta = { carregando: true, q };
    renderConsulta();
    try { B.consulta = { q, ...(await rpc("consultar_entregador", { p_busca: q })) }; }
    catch (e) { B.consulta = { q, erro: msgErro(e) }; }
    renderConsulta();
  });
  function renderConsulta() {
    const box = $("#bq-consulta"), c = B.consulta;
    if (!c) return box.replaceChildren(el("p", { class: "meta", text: "Busque pelo ID do entregador (completo) ou por parte do nome. Aparecem os bloqueios e o cadastro na ativação." }));
    if (c.carregando) return box.replaceChildren(carregandoEl());
    if (c.erro) return box.replaceChildren(el("p", { class: "err", text: c.erro }));
    const bl = c.bloqueios || [];
    const ids = [...new Set(bl.map((b) => b.id_app.toLowerCase()))];
    box.replaceChildren(
      el("div", { class: "panel" },
        el("h3", { text: "Cadastro na ativação" }),
        c.cadastros.length ? el("ul", {}, c.cadastros.map((x) => el("li", { text: `${x.id_app || "(sem ID)"} · ${x.situacao} · ${x.cidade} · enviado em ${dt(x.enviado_em)}${x.motivo ? " · " + x.motivo : ""}` }))) : el("p", { class: "meta", text: "Nenhum cadastro encontrado." })),
      el("div", { class: "panel" },
        el("h3", { text: bl.length ? `${bl.length} bloqueio(s)` + (ids.length > 1 ? ` em ${ids.length} IDs diferentes` : "") : "Nenhum bloqueio encontrado" }),
        bl.length ? el("div", { class: "chips", style: "margin-bottom:10px" },
          el("span", { class: "chip" + (bl.some((b) => b.situacao === "bloqueado") ? " x" : ""), text: bl.some((b) => b.situacao === "bloqueado") ? "Bloqueado agora" : "Não está bloqueado agora" }),
          bl.some((b) => b.situacao === "encerramento") ? el("span", { class: "chip x", text: "Parceria encerrada" }) : null) : null,
        bl.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela(
          [["Data"], ["Entregador"], ["Infração"], ["Ocorr."], ["Punição"], ["Situação"], ["Registrado por"], ["Tratativa"]],
          bl.map((b) => el("tr", {}, el("td", { text: dt(b.inicio) }), el("td", {}, b.nome, el("br"), el("span", { class: "mono meta", text: b.id_app })),
            el("td", { text: b.infracao }), el("td", { text: ord(b.ocorrencia) }), el("td", { text: horasTxt(b.horas) }), el("td", {}, pillSit(b.situacao)),
            el("td", { text: b.registrado_por_nome }), el("td", {}, bulletTratativa(b)))), ""))) : null));
  }

  // ---------- histórico ----------
  function renderHist() {
    const l = B.lista.todos, t = $("#bq-t-hist");
    const cols = [["Situação"], ["Entregador"], ["Infração"], ["Ocorr."], ["Punição"], ["Início"], ["Cidade"], ["Registrado por"], ["Tratativa"], [""]];
    if (!l) return t.replaceChildren(...tabela(cols, [], "Carregando…"));
    preencher($("#bq-hist-cidade"), opcCidades(l), "Todas as cidades");
    preencher($("#bq-hist-inf"), opcInfracoes(), "Todas as infrações");
    preencher($("#bq-hist-quem"), [...new Set(l.map((b) => b.registrado_por_nome))].sort().map((n) => [n, n]), "Registrado por qualquer pessoa");
    const q = $("#bq-q-hist").value, sit = $("#bq-hist-sit").value, cid = $("#bq-hist-cidade").value, inf = $("#bq-hist-inf").value, quem = $("#bq-hist-quem").value;
    const lista = l.filter((b) => buscaB(b, q) && (!sit || (sit === "revisar" ? !!b.revisar : b.situacao === sit)) && (!cid || b.cidade === cid) && (!inf || String(b.infracao_id) === inf) && (!quem || b.registrado_por_nome === quem));
    B.histFiltrado = lista;
    $("#bq-hist-total").textContent = `${lista.length} de ${l.length} bloqueio(s)`;
    t.replaceChildren(...tabela(cols, lista.slice(0, 500).map((b) => {
      const acoes = el("td", { style: "white-space:nowrap" });
      if (mod()) {
        if (B.confirmar[b.id]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => excluir(b, e.currentTarget) }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete B.confirmar[b.id]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { B.confirmar[b.id] = true; render(); } }, "Excluir"));
      }
      return el("tr", {}, el("td", {}, pillSit(b.situacao), b.revisar ? el("div", { class: "alerta-revisar", text: "revisar", title: b.revisar }) : null),
        el("td", {}, b.nome, el("br"), el("span", { class: "mono meta", text: b.id_app })),
        el("td", { text: b.infracao }), el("td", { text: ord(b.ocorrencia) + (b.ocorrencia < b.ocorrencia_total ? ` (${ord(b.ocorrencia_total)})` : "") }),
        el("td", { text: horasTxt(b.horas) }), el("td", { text: dt(b.inicio) }), el("td", { text: b.cidade || "—" }), el("td", { text: b.registrado_por_nome }),
        el("td", {}, bulletTratativa(b)), acoes);
    }), "Nenhum bloqueio com esse filtro."));
  }
  async function excluir(b, btn) {
    btn.disabled = true;
    try { await rpc("excluir_bloqueio", { p_bloqueio: b.id }); delete B.confirmar[b.id]; toast("Bloqueio excluído."); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  $("#bq-export").addEventListener("click", () => baixarCSV("bloqueios",
    ["id_entregador", "nome", "cidade", "infracao", "ocorrencia", "ocorrencia_historico", "horas", "situacao", "inicio", "fim", "registrado_por", "tratativa", "tratativa_responsavel", "tratativa_concluida_em", "tratativa_nota", "liberado_antes_em", "motivo_liberacao", "revisar"],
    (B.histFiltrado || []).map((b) => [b.id_app, b.nome, b.cidade, b.infracao, b.ocorrencia, b.ocorrencia_total, b.horas ?? "encerramento", SIT[b.situacao], b.inicio, b.fim, b.registrado_por_nome,
      b.tarefa ? (b.tarefa.status === "pendente" ? "pendente" : "realizada") : "sem tratativa", b.tarefa?.responsavel_nome, b.tarefa?.concluida_em, b.tarefa?.nota, b.liberado_em, b.motivo_liberacao, b.revisar])));

  // ---------- painel ----------
  function renderPainel() {
    const P = B.painel;
    document.querySelectorAll("[data-periodo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.periodo === String(P.periodo))));
    document.querySelectorAll("[data-filtro-bq]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filtroBq === P.filtro)));
    caixaPessoas($("#bq-pessoas"), P, () => { B.metricas = null; render(); carregar(); });
    preencher($("#bq-f-cidade"), cidadesAtivas().map((c) => [c.nome, c.nome]), "Todas as cidades");
    preencher($("#bq-f-infracao"), opcInfracoes(), "Todas as infrações");
    const periodo = P.periodo === "tudo" ? "desde o início" : `nos últimos ${P.periodo} dias`;
    const quem = P.filtro === "todos" ? "toda a equipe" : P.filtro === "eu" ? "você" : nomesEscolhidos(P);
    $("#bq-painel-sub").textContent = `Bloqueios ${periodo}` + (P.filtro === "todos" ? "." : `, registrados ou tratados por ${quem}.`);
    const m = B.metricas;
    if (!m) { $("#bq-tiles").replaceChildren(vazio("Carregando…")); return; }
    const r = m.resumo;
    const tile = (k, v, d, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }), el("div", { class: "d", text: d }));
    $("#bq-tiles").replaceChildren(
      tile("Bloqueios registrados", r.total, `${r.entregadores} entregador(es)`),
      tile("Bloqueados agora", r.bloqueados_agora, "entre os do período", "hl2"),
      tile("Reincidências", r.reincidentes, "2ª ocorrência ou mais", "hl"),
      tile("Encerramentos de parceria", r.encerramentos, "bloqueios definitivos"),
      tile("Tratativas pendentes", r.tratativas_pendentes, "aguardando o responsável", "hl"),
      tile("Tratativas realizadas", r.tratativas_feitas, "pelo sistema (sem importadas)", "good"),
      tile("Tempo até a tratativa", horas(r.horas_ate_tratativa), "média, do registro à tratativa"),
      tile("Liberados antes do prazo", r.liberados_antes, "por monitorador ou moderador"));
    $("#bq-chart").replaceChildren(grafico(m.por_dia.map((d) => ({ ...d, primeira: d.total - d.reincidencias - d.encerramentos })),
      [["primeira", "var(--accent)", "1ª ocorrência"], ["reincidencias", "var(--warn)", "reincidência(s)"], ["encerramentos", "var(--bad)", "encerramento(s)"]],
      null, "Bloqueios por dia"));
    $("#bq-t-infracao").replaceChildren(...tabela([["Infração"], ["Bloqueios", 1], ["Reincidências", 1], ["Encerramentos", 1]],
      m.por_infracao.map((x) => el("tr", {}, el("td", { text: x.infracao }), el("td", { class: "num", text: x.total }), el("td", { class: "num", text: x.reincidencias }), el("td", { class: "num", text: x.encerramentos }))), "Nenhum bloqueio no período."));
    $("#bq-t-cidade").replaceChildren(...tabela([["Cidade"], ["Bloqueios", 1], ["Bloqueados agora", 1], ["Encerramentos", 1], ["Tratativas pendentes", 1]],
      m.por_cidade.map((x) => el("tr", {}, el("td", { text: x.cidade }), el("td", { class: "num", text: x.total }), el("td", { class: "num", text: x.bloqueados_agora }), el("td", { class: "num", text: x.encerramentos }), el("td", { class: "num", text: x.tratativas_pendentes }))), "Nenhum bloqueio no período."));
    $("#bq-t-pessoa").replaceChildren(...tabela([["Pessoa"], ["Registrou", 1], ["Tratou", 1]],
      m.por_pessoa.map((x) => el("tr", {}, el("td", { text: x.nome === S.me.nome ? `${x.nome} (você)` : x.nome }), el("td", { class: "num", text: x.registrou }), el("td", { class: "num", text: x.tratou }))), "Sem atividade no período."));
    $("#bq-t-reinc").replaceChildren(...tabela([["Entregador"], ["Cidade"], ["Bloqueios", 1], ["Último"], ["Situação"]],
      m.reincidentes.map((x) => el("tr", {}, el("td", {}, x.nome, el("br"), el("span", { class: "mono meta", text: x.id_app })), el("td", { text: x.cidade || "—" }), el("td", { class: "num", text: x.bloqueios }), el("td", { text: dt(x.ultimo) }), el("td", { text: x.bloqueado_agora ? "Bloqueado" : "Liberado" }))),
      "Nenhum entregador com mais de um bloqueio no período."));
  }
  document.querySelectorAll("[data-periodo]").forEach((b) => b.addEventListener("click", () => { B.painel.periodo = b.dataset.periodo === "tudo" ? "tudo" : Number(b.dataset.periodo); B.metricas = null; render(); carregar(); }));
  document.querySelectorAll("[data-filtro-bq]").forEach((b) => b.addEventListener("click", () => {
    B.painel.filtro = b.dataset.filtroBq;
    if (B.painel.filtro === "escolher" && !B.painel.escolhidos.size) B.painel.escolhidos.add(S.me.id);
    B.metricas = null; render(); carregar();
  }));
  ["#bq-f-cidade", "#bq-f-infracao"].forEach((s) => $(s).addEventListener("change", () => { B.painel.cidade = $("#bq-f-cidade").value; B.painel.infracao = $("#bq-f-infracao").value; B.metricas = null; render(); carregar(); }));
  document.querySelectorAll("[data-trat]").forEach((b) => b.addEventListener("click", () => { B.tratVer = b.dataset.trat; render(); carregar(); }));

  // ---------- regras (moderador) ----------
  function renderRegras() {
    const R = B.regras;
    if (!R) return;
    const linhas = R.infracoes.map((i) => linhaInfracao(i));
    linhas.push(linhaInfracao({ id: null, nome: "", horas_1a: null, horas_2a: null, terceira_encerra: false, fator: 1.3, janela_dias: null, ativa: true, previstas: [] }));
    $("#bq-t-regras").replaceChildren(
      el("thead", {}, el("tr", {}, ["Infração", "1ª (h)", "2ª (h)", "3ª encerra?", "Aumento da 3ª em diante", "Zera a contagem após", "Ativa", "Punições previstas (1ª → 5ª)", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, linhas));
    $("#bq-t-cidades").replaceChildren(
      el("thead", {}, el("tr", {}, ["Cidade", "Responsável pela tratativa", "Ativa"].map((h) => el("th", { text: h })))),
      el("tbody", {}, R.cidades.map((c) => {
        const sel = el("select", { "aria-label": "Responsável por " + c.nome, onchange: (e) => salvarCidade(c.nome, e.target.value, c.ativa, e.target) },
          el("option", { value: "", text: "Ninguém (avisa todos os moderadores)" }), ...R.responsaveis.map((p) => el("option", { value: p.email, text: `${p.nome} (${PAPEL[p.papel]})` })));
        sel.value = c.responsavel_valido ? c.responsavel_email : "";
        const at = el("input", { type: "checkbox", "aria-label": "Cidade ativa", onchange: (e) => salvarCidade(c.nome, sel.value, e.target.checked, e.target) });
        at.checked = c.ativa;
        return el("tr", {}, el("td", { text: c.nome }), el("td", {}, sel, c.responsavel_email && !c.responsavel_valido ? el("div", { class: "alerta-revisar", text: `${c.responsavel_nome || c.responsavel_email} não é mais monitorador` }) : null), el("td", {}, at));
      })));
  }
  function linhaInfracao(i) {
    const nova = i.id == null;
    const num = (v, rot, ph) => { const n = el("input", { type: "number", min: "1", step: "1", "aria-label": rot, placeholder: ph }); n.value = v ?? ""; return n; };
    const nome = el("input", { type: "text", "aria-label": "Nome da infração", placeholder: nova ? "Nova infração…" : "", maxlength: "150" }); nome.value = i.nome;
    const h1 = num(i.horas_1a, "Horas na 1ª ocorrência", "encerra"), h2 = num(i.horas_2a, "Horas na 2ª ocorrência", "encerra");
    const t3 = el("input", { type: "checkbox", "aria-label": "A 3ª ocorrência encerra a parceria" }); t3.checked = i.terceira_encerra;
    const fator = el("input", { type: "number", min: "0", max: "400", step: "5", "aria-label": "Aumento em % a partir da 3ª" }); fator.value = Math.round((Number(i.fator) - 1) * 100);
    const jan = num(i.janela_dias, "Zera a contagem após quantos dias sem ocorrência", "nunca");
    const at = el("input", { type: "checkbox", "aria-label": "Infração ativa" }); at.checked = i.ativa;
    return el("tr", {},
      el("td", {}, nome), el("td", {}, h1), el("td", {}, h2), el("td", {}, el("label", { class: "check" }, t3, "sim")),
      el("td", {}, fator, " %"), el("td", {}, jan, " dias"), el("td", {}, at),
      el("td", {}, el("div", { class: "chips" }, (i.previstas || []).map((h) => el("span", { class: "chip" + (h == null ? " x" : ""), text: h == null ? "encerra" : `${h} h` })))),
      el("td", {}, el("button", { class: nova ? "btn small" : "btn primary small", type: "button", onclick: (e) => salvarInfracao(i.id, {
        nome: nome.value, h1: h1.value, h2: h2.value, t3: t3.checked, fator: 1 + Number(fator.value || 0) / 100, jan: jan.value, ativa: at.checked }, e.currentTarget) }, nova ? "Adicionar" : "Salvar")));
  }
  async function salvarInfracao(id, v, btn) {
    btn.disabled = true;
    try {
      await rpc("salvar_infracao", { p_id: id, p_nome: v.nome, p_horas_1a: v.h1 ? Number(v.h1) : null, p_horas_2a: v.h2 ? Number(v.h2) : null,
        p_terceira_encerra: v.t3, p_fator: v.fator, p_janela_dias: v.jan ? Number(v.jan) : null, p_ativa: v.ativa });
      toast(id ? "Regra atualizada. Vale para os próximos bloqueios." : "Infração adicionada.");
      B.regras = await rpc("regras_bloqueio"); render();
    } catch (e) { toast(msgErro(e)); }
    finally { btn.disabled = false; }
  }
  async function salvarCidade(nome, resp, ativa, ctrl) {
    ctrl.disabled = true;
    try { await rpc("salvar_cidade", { p_nome: nome, p_responsavel_email: resp || null, p_ativa: ativa }); toast(`${nome} atualizada.`); B.regras = await rpc("regras_bloqueio"); render(); }
    catch (e) { toast(msgErro(e)); }
    finally { ctrl.disabled = false; }
  }
  $("#bq-f-nova-cidade").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const n = $("#bq-nova-cidade").value.trim();
    if (!n) return;
    try { await rpc("salvar_cidade", { p_nome: n, p_responsavel_email: null, p_ativa: true }); toast("Cidade adicionada."); ev.target.reset(); B.regras = await rpc("regras_bloqueio"); render(); }
    catch (e) { toast(msgErro(e)); }
  });

  // ---------- filtros que só redesenham ----------
  ["#bq-q-trat", "#bq-trat-cidade", "#bq-q-ativos", "#bq-ativos-cidade", "#bq-ativos-inf", "#bq-q-meus", "#bq-meus-sit", "#bq-meus-inf",
   "#bq-q-hist", "#bq-hist-sit", "#bq-hist-cidade", "#bq-hist-inf", "#bq-hist-quem"].forEach((s) => $(s).addEventListener("input", render));

  App.bloqueios = { cardBloqueio, concluir, horasTxt, ord, B };
  App.modulo({
    id: "bloqueios", nome: "Bloqueios",
    acesso: () => !!papel(),
    abas: [
      { id: "tratativas", nome: "Tratativas", secao: "v-bq-tratativas", pode: staff, contador: "c-trat", alerta: true },
      { id: "novo", nome: "Novo bloqueio", secao: "v-bq-novo" },
      { id: "ativos", nome: "Bloqueados agora", secao: "v-bq-ativos", pode: staff },
      { id: "meus", nome: "Meus registros", secao: "v-bq-meus" },
      { id: "consultar", nome: "Consultar entregador", secao: "v-bq-consultar" },
      { id: "painel", nome: "Painel", secao: "v-bq-painel" },
      { id: "historico", nome: "Histórico", secao: "v-bq-historico", pode: staff },
      { id: "regras", nome: "Regras", secao: "v-bq-regras", pode: mod },
    ],
    padrao: () => (staff() ? "tratativas" : "novo"),
    async carregar(aba) {
      const t = [];
      if (!B.regras || aba === "regras") t.push(rpc("regras_bloqueio").then((d) => (B.regras = d)));
      if (aba === "tratativas") t.push(rpc("listar_tarefas", { p_status: B.tratVer }).then((d) => (B.tarefas[B.tratVer] = d)));
      if (aba === "ativos") t.push(rpc("listar_bloqueios", { p_escopo: "ativos" }).then((d) => (B.lista.ativos = d)));
      if (aba === "meus") t.push(rpc("listar_bloqueios", { p_escopo: "meus" }).then((d) => (B.lista.meus = d)));
      if (aba === "historico") t.push(rpc("listar_bloqueios", { p_escopo: "todos" }).then((d) => (B.lista.todos = d)));
      if (aba === "painel") {
        const P = B.painel;
        t.push(rpc("metricas_bloqueios", { p_pessoas: filtroPessoas(P), p_dias: P.periodo === "tudo" ? null : P.periodo,
          p_cidade: P.cidade || null, p_infracao: P.infracao ? Number(P.infracao) : null }).then((d) => (B.metricas = d)));
      }
      await Promise.all(t);
    },
    render(aba) {
      ({ tratativas: renderTratativas, novo: renderNovo, ativos: renderAtivos, meus: renderMeus, consultar: renderConsulta,
         painel: renderPainel, historico: renderHist, regras: renderRegras })[aba]?.();
    },
    contadores() {
      if (staff()) App.contador("c-trat", S.resumo?.bloqueios?.tratativas_pendentes || 0);
    },
  });
})();
