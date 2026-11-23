// Módulo "Atividades": a caixa de entrada de cada pessoa. Junta as pendências dos dois módulos
// (cadastros para analisar, tratativas de bloqueio) e os avisos recebidos.
// As tarefas de bloqueio vêm da tabela "tarefas"; as da ativação, dos números de cadastros;
// as atividades sugeridas (qualquer pessoa cria, alguém aceita), da tabela "atividades".
// 009d2: a aba "Tarefas" mostra as atividades como cards por tipo (campos próprios, prazo padrão, progresso,
// aguardando terceiro, checklist, comentários com @menções, agradecimentos, "Pegar a próxima").
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, duracao, toast, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const A = { tipos: null, tarefas: null, atividades: null, caixa: {}, marcando: false, conf: {} };
  const staffAtiv = () => ["moderador", "monitorador"].includes(S.me?.papel);
  const staffBloq = () => ["moderador", "monitorador"].includes(S.me?.papel_bloqueios);
  const render = () => App.render();

  function totalPendencias() {
    const r = S.resumo;
    if (!r) return null;
    return (staffAtiv() ? r.ativacao.aguardando_analise : 0) + (staffBloq() ? r.bloqueios?.tratativas_pendentes || 0 : 0)
      + (r.atividades?.para_aceitar || 0) + (r.atividades?.minhas_em_andamento || 0) + (r.pedidos_cidade?.length || 0);
  }

  // opcional: cartão menor, com a etiqueta "Opcional" (formato reutilizável para tarefas que qualquer um pode pegar)
  function item({ modulo, titulo, detalhe, acoes = [], extra = null, estado = "pendente", atrasada = false, opcional = false }) {
    return el("li", { class: "card" + (atrasada ? " atrasada" : "") + (opcional ? " opcional" : ""), style: "list-style:none" },
      el("div", { class: "head" }, el("span", { class: "name" }, el("span", { class: "tag", text: modulo }), opcional ? el("span", { class: "tag opcional", text: "Opcional" }) : null, titulo)),
      detalhe ? el("div", { class: "bullet " + estado, text: detalhe }) : null,
      acoes.length ? el("div", { class: "actions" }, acoes) : null,
      extra);
  }

  function renderPendencias() {
    const box = $("#at-lista");
    const r = S.resumo;
    if (!r || (S.me.papel_bloqueios && !A.tarefas) || !A.atividades) return box.replaceChildren(carregandoEl());
    const itens = [], opcionais = [];
    // tarefas opcionais (de qualquer um): no fim da lista, discretas
    for (const a of A.atividades.filter((x) => x.status === "aberta" && x.opcional_para_mim && x.pode_aceitar))
      opcionais.push(item({ modulo: "ATIVIDADE", titulo: a.titulo, opcional: true,
        detalhe: `${a.descricao || ""} Quem pegar primeiro tira dos outros.`.trim(),
        acoes: [el("button", { class: "btn small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Tarefa aceita. Ela está com você.") }, "Eu faço"),
          a.cadastro_id ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirCadastro(a.cadastro_id) }, "Completar agora") : null].filter(Boolean) }));
    // os "revisar" dos bloqueios (vindos da planilha): um cartão só, opcional
    const nRev = S.resumo?.bloqueios_revisar || 0;
    if (S.me.papel_bloqueios && nRev)
      opcionais.push(item({ modulo: "RESTRIÇÕES", opcional: true, titulo: `Revisar registros da planilha: faltam ${nRev}`,
        detalhe: "Restrições com a marca “revisar” (dados conflitantes da importação). Cada uma corrigida ou conferida sai da conta.",
        acoes: [el("button", { class: "btn small", type: "button", onclick: () => App.bloqueios?.abrirRevisar?.() }, "Abrir os registros para revisar")] }));
    // 009m (Minha fila): as tarefas para você ou com você aparecem com o cartão completo (dá para aceitar, concluir,
    // comentar sem trocar de tela); as abertas para a equipe continuam na aba Tarefas
    const minhas = A.atividades.filter((x) => (x.status === "aberta" && x.pode_aceitar && !x.opcional_para_mim && x.criada_por !== S.me.id && x.para_mim) || (x.status === "aceita" && x.sou_participante && !x.automatica))
      .sort((x, y) => String(x.prazo || "9").localeCompare(String(y.prazo || "9")));
    // Pedidos para ser responsável de cidade (moderadores, 008b)
    itens.push(...App.avisos.cartoesPedidos(item).map((li) => { li.dataset.tipo = "pedidos"; return li; }));
    // 009z4 (NF-9): retornos combinados com o entregador (lembrete no comentário da ficha)
    for (const l of A.lembretes || []) {
      const quem = l.nome || "ID " + l.id_app;
      const li = item({ modulo: "RETORNO", titulo: `Retornar a ${quem}`, estado: l.vencido ? "atrasada" : "pendente", atrasada: l.vencido,
        detalhe: `${l.vencido ? "Era para " : "Lembrete para "}${dt(l.lembrar_em)} · ${l.texto}`,
        acoes: [el("button", { class: "btn small primary", type: "button", onclick: (e) => acaoAtividade("concluir_lembrete", { p_id: l.id }, e.currentTarget, "Retorno feito.") }, "Feito"),
          el("button", { class: "btn link", type: "button", onclick: () => App.abrirFicha?.(l.id_app) }, "Ver a ficha")] });
      li.dataset.lembrete = l.id; li.dataset.tipo = "retornos";
      itens.push(li);
    }
    // 009y2 (pedido do usuário): "porta-cartões": o botão abre logo abaixo os cartões curtos (os mesmos da tela inicial),
    // com Aprovar/Reprovar ali mesmo; "Abrir a tela completa" continua no fim
    const porta = (chave, txt, href, rotulo) => {
      const aberta = App.previa?.aberta("fila") === chave;
      if (!App.previa) return { acoes: [el("a", { class: "btn primary small", href }, "Abrir")] };
      return { acoes: [el("button", { class: "btn small" + (aberta ? "" : " primary"), type: "button", "aria-expanded": String(aberta), onclick: () => App.previa.alternar("fila", chave) }, aberta ? "Fechar" : rotulo)],
        extra: aberta ? App.previa.tira({ chave, txt, href }) : null };
    };
    // Ativação
    const tipar = (tipo, li, n = 1) => { li.dataset.tipo = tipo; li.dataset.n = n; return li; };
    if (staffAtiv() && r.ativacao.aguardando_analise)
      itens.push(tipar("cadastros", item({ modulo: "ATIVAÇÃO", titulo: App.u.plural(r.ativacao.aguardando_analise, "cadastro aguardando análise", "cadastros aguardando análise"),
        ...porta("cadastros", App.u.plural(r.ativacao.aguardando_analise, "cadastro aguardando análise", "cadastros aguardando análise"), "#ativacao/pendentes", "Ver os cadastros") }), r.ativacao.aguardando_analise));
    if (!staffAtiv() && (r.ativacao.aguardando_analise || r.ativacao.aguardando_contato))
      itens.push(tipar("cadastros", item({ modulo: "ATIVAÇÃO", titulo: "Seus cadastros em andamento", estado: "sem",
        detalhe: `${r.ativacao.aguardando_analise} aguardando análise · ${r.ativacao.aguardando_contato} aguardando novo contato. Você acompanha, quem decide é o responsável.`,
        acoes: [el("a", { class: "btn small", href: "#ativacao/pendentes" }, "Acompanhar")] })));
    // Bloqueios
    const minhasTrat = [];
    for (const t of A.tarefas || []) {
      const b = t.bloqueio;
      const tipo = App.bloqueios.TAREFA[t.tipo] || "Tratativa";
      if (t.tipo === "completar_dados") {
        if (staffBloq()) itens.push(tipar("tratativas", item({ modulo: "RESTRIÇÕES", titulo: `${tipo}: ID ${b.id_app}`,
          detalhe: `Registrado só com o ID (${b.infracao}) por ${b.registrado_por_nome} há ${duracao(t.criada_em).txt}. Falta nome e cidade.`,
          acoes: [el("a", { class: "btn approve small", href: "#bloqueios/tratativas" }, "Completar na tela de tratativas")] })));
        continue;
      }
      const punicao = App.bloqueios.horasTxt(b.horas);
      const fimTrat = t.prazo_horas ? new Date(new Date(t.criada_em).getTime() + t.prazo_horas * 3600000) : null;
      if (staffBloq() && t.minha) {
        // 009z5 (pedido do usuário): as tratativas viram um porta-cartões só (cartões curtos logo abaixo, como na tela inicial)
        minhasTrat.push(t);
      } else if (!staffBloq() && b.registrado_por === S.me.id) {  // 009x6: o suporte vê todas, mas acompanha só as que registrou
        itens.push(tipar("tratativas", item({ modulo: "RESTRIÇÕES", titulo: `Acompanhando: ${tipo.toLowerCase()} de ${b.nome}`, estado: "pendente",
          detalhe: `Pendente com ${t.responsavel_nome} há ${duracao(t.criada_em).txt} · ${b.infracao} · ${punicao}`,
          extra: App.u.previsao(t, "tarefa", t.id, false),
          acoes: [el("a", { class: "btn small", href: "#bloqueios/historico" }, "Ver no Histórico")] })));
      }
    }
    if (minhasTrat.length) {
      const atr = minhasTrat.filter((t) => t.atrasada).length;
      const txt = App.u.plural(minhasTrat.length, "tratativa com você", "tratativas com você");
      const li = item({ modulo: "RESTRIÇÕES", titulo: txt + (atr ? ` · ${App.u.plural(atr, "atrasada", "atrasadas")}` : ""), atrasada: atr > 0,
        ...porta("tratativas", txt, "#bloqueios/tratativas", "Ver as tratativas") });
      itens.push(tipar("tratativas", li, minhasTrat.length));
    }
    // 009y1 (OP-4): as 3 tarefas abertas para a equipe mais urgentes (prazo mais perto, depois a mais antiga), com
    // "Eu faço", sem ir até a aba Tarefas
    const ja = new Set(minhas.map((x) => x.id));
    const abertas = A.atividades.filter((x) => x.status === "aberta" && !x.automatica && x.pode_aceitar && !x.opcional_para_mim && x.criada_por !== S.me.id && !ja.has(x.id))
      .sort((x, y) => String(x.prazo || "9").localeCompare(String(y.prazo || "9")) || String(x.criada_em).localeCompare(String(y.criada_em)));
    const blocoAbertas = abertas.length ? el("div", { class: "grupo", id: "at-abertas-fila" },
      el("h3", {}, "Abertas para a equipe", el("span", { class: "count", text: abertas.length })),
      el("ul", { class: "queue", style: "padding:0;margin:0" }, abertas.slice(0, 3).map((a) => item({ modulo: "TAREFA", titulo: a.titulo,
        detalhe: [a.cidade, a.prazo ? `prazo ${App.u.dt(a.prazo)}` : "sem prazo", a.criada_por_nome ? `pedida por ${a.criada_por_nome}` : null].filter(Boolean).join(" · "),
        acoes: [el("button", { class: "btn primary small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Tarefa aceita. Ela está com você.") }, "Eu faço")] }))),
      abertas.length > 3 ? el("a", { class: "btn link", href: "#atividades/sugeridas" }, `Ver todas as ${abertas.length} abertas`) : null) : null;
    if (!itens.length && !opcionais.length && !minhas.length && !blocoAbertas && !A.atividades.some((x) => x.automatica && x.status !== "concluida")) return box.replaceChildren(vazio("Tudo em dia", "Nenhuma pendência para você agora. Novas tarefas aparecem aqui assim que forem criadas."));
    // 009y1c: atividades da equipe (automáticas): de todos, sem aceitar; no topo da Minha fila
    const daEquipe = A.atividades.filter((x) => x.automatica && x.status !== "concluida");
    const blocoEquipe = daEquipe.length ? el("div", { class: "grupo", id: "at-equipe-fila" },
      el("h3", {}, "Atividades da equipe", el("span", { class: "count", text: daEquipe.length })),
      el("p", { class: "meta", style: "margin:0 0 6px", text: "Criadas pelo sistema. Todos participam: cada aprovação na cidade conta, e ela fecha sozinha quando bate a meta. Se não precisar mais, qualquer pessoa conclui antes, com o motivo." }),
      el("div", { class: "queue" }, daEquipe.map(cartaoAtividade))) : null;
    // 009z5 (pedido do usuário): no lugar do "Vence hoje", filtros pelo que aparece nesta tela (Tarefas, Tratativas, Cadastros...)
    const doTipo = (t) => itens.filter((x) => x.dataset.tipo === t);
    const soma = (l) => l.reduce((n, x) => n + Number(x.dataset.n || 1), 0);
    const grupos = [
      ["tarefas", "Tarefas", minhas.length],
      ["tratativas", "Tratativas", soma(doTipo("tratativas"))],
      ["cadastros", "Cadastros", soma(doTipo("cadastros"))],
      ["retornos", "Retornos", doTipo("retornos").length],
      ["pedidos", "Pedidos de cidade", doTipo("pedidos").length],
      ["equipe", "Atividades da equipe", daEquipe.length],
      ["abertas", "Abertas para a equipe", abertas.length],
      ["opcionais", "Opcionais", opcionais.length],
    ].filter(([, , n]) => n);
    if (A.filtroFila && !grupos.some(([t]) => t === A.filtroFila)) A.filtroFila = null;
    const f = A.filtroFila, ver = (t) => !f || f === t;
    const chip = (t, rotulo, n) => el("button", { class: "chip" + (f === t ? " ativo" : ""), type: "button", "aria-pressed": String(f === t), "data-filtro": t || "tudo",
      onclick: () => { A.filtroFila = f === t ? null : t; render(); } }, n == null ? rotulo : `${rotulo} (${n})`);
    const filtros = grupos.length > 1 ? el("div", { class: "fila-filtro", id: "at-fila-filtros", role: "group", "aria-label": "Mostrar" },
      chip(null, "Tudo"), ...grupos.map(([t, rotulo, n]) => chip(t, rotulo, n))) : null;
    const itensVer = itens.filter((x) => ver(x.dataset.tipo));
    box.replaceChildren(...[
      filtros,
      ver("equipe") ? blocoEquipe : null,
      ver("tarefas") && minhas.length ? el("div", { class: "grupo" }, el("h3", {}, "Tarefas com você", el("span", { class: "count", text: minhas.length })),
        el("div", { class: "queue" }, minhas.map(cartaoAtividade))) : null,
      itensVer.length ? el("ul", { class: "queue", style: "padding:0;margin:0" }, itensVer) : f || minhas.length || blocoAbertas ? null : vazio("Tudo em dia", "Nenhuma pendência só sua agora."),
      ver("abertas") ? blocoAbertas : null,
      ver("opcionais") && opcionais.length ? el("div", { class: "grupo" }, el("h3", {}, "Opcionais: quem puder, pega", el("span", { class: "count", text: opcionais.length })),
        el("ul", { class: "queue", style: "padding:0;margin:0" }, opcionais)) : null].filter(Boolean));
  }

  // ---------- atividades sugeridas ----------
  function preencherPessoas() {
    const box = $("#at-para");
    const sig = S.pessoas.map((p) => p.id).join("|");
    if (box.dataset.sig === sig) return;
    const marcadas = new Set([...box.querySelectorAll("input:checked")].map((x) => x.value));
    box.dataset.sig = sig;
    box.replaceChildren(...S.pessoas.map((p) => {
      const cb = el("input", { type: "checkbox", value: p.id }); cb.checked = marcadas.has(p.id);
      return el("label", {}, cb, p.id === S.me.id ? `${p.nome} (você)` : p.nome);
    }));
  }
  // ---------- tarefas em cards (009d2; antes "atividades sugeridas") ----------
  // Campos de cada tipo (o banco valida de novo em validar_campos_tarefa)
  const CAMPOS = {
    ativar_entregadores: [["cidade", "Cidade", "cidade", true], ["quantidade", "Quantos entregadores aprovar", "numero", true], ["motivo", "Motivo", "texto", false]],
    ativar_parceiro: [["cidade", "Cidade", "cidade", true], ["quantidade", "Quantos parceiros ativar", "numero", true], ["motivo", "Motivo", "texto", false]],
    fazer_contato: [["contato", "Pessoa ou estabelecimento", "texto", true], ["cidade", "Cidade", "cidade", true], ["telefone", "Número", "texto", false], ["motivo", "Motivo", "texto", true]],
    contato_entregador: [["id_app", "ID do entregador", "id", true], ["tratativa", "É tratativa?", "sim_nao", true], ["motivo", "Motivo", "lista", false], ["detalhe", "Detalhes", "texto", false]],
    pedido_problema: [["pedido", "Código do pedido (sem os números)", "texto", true], ["cidade", "Cidade", "cidade", true], ["problema", "O que aconteceu", "texto", true]],
    pagamento_entregador: [["id_app", "ID do entregador", "id", true], ["valor", "Valor (R$)", "valor", true], ["motivo", "Motivo", "texto", true]],
    revisar_registro: [["referencia", "Qual registro (ID, pedido ou link)", "texto", true], ["motivo", "O que revisar", "texto", true]],
    criar_comunicado: [["cidade", "Cidade", "cidade", true], ["motivo", "Sobre o quê", "texto", true]],
    procurar_entregador: [["cidade", "Cidade sem entregadores online", "cidade", true], ["detalhe", "Detalhes", "texto", false]],
    livre: [],
  };
  const ROTULO_CAMPO = Object.fromEntries(Object.values(CAMPOS).flat().map(([k, r]) => [k, r]));
  const F = { tipo: "livre", modo: "solicitacao" };
  const horasTxt = (h) => (h == null ? "sem prazo padrão" : h < 1 ? `${Math.round(h * 60)} min` : h % 24 === 0 && h >= 24 ? `${h / 24} dia(s)` : `${String(h).replace(".", ",")} h`);
  const tempo = (seg) => { if (seg == null) return "—"; const m = Math.round(seg / 60); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}`.trim() : `${Math.round(m / 144) / 10} dias`.replace(".", ","); };
  const tipoDe = (t) => A.tipos?.tipos.find((x) => x.tipo === t);

  // campos do tipo dentro de um elemento (usado na Nova tarefa e nas recorrentes, js/painel.js)
  function montarCampos(box, tipo) {
    if (box.dataset.tipo === tipo) return;
    box.dataset.tipo = tipo;
    const lista = "at-cidades-" + (box.id || "x");
    box.replaceChildren(...CAMPOS[tipo].map(([k, rot, tp, obrig]) => {
      let campo;
      if (tp === "sim_nao") campo = el("select", { "data-campo": k }, el("option", { value: "", text: "Escolha" }), el("option", { value: "sim", text: "Sim" }), el("option", { value: "nao", text: "Não" }));
      else if (tp === "lista") campo = el("select", { "data-campo": k }, el("option", { value: "", text: "Escolha o motivo" }), ...A.tipos.motivos_contato.map((m) => el("option", { value: m, text: m })));
      else campo = el("input", { "data-campo": k, maxlength: 600, inputmode: tp === "numero" || tp === "valor" ? "decimal" : null, list: tp === "cidade" ? lista : null,
        placeholder: tp === "cidade" ? "CIDADE - UF" : tp === "id" ? "Só letras e números" : null, autocomplete: "off" });
      return el("label", { class: tp === "texto" && k !== "telefone" ? "largo" : null }, el("span", {}, rot, obrig ? el("span", { class: "req", text: " *" }) : el("span", { class: "hint", text: " Opcional" })), campo);
    }), el("datalist", { id: lista }, App.u.CIDADES.map((c) => el("option", { value: c }))));
    // motivo do contato só quando não é tratativa
    const trat = box.querySelector("[data-campo=tratativa]"), mot = box.querySelector("[data-campo=motivo]");
    if (tipo === "contato_entregador") { const ver = () => (mot.closest("label").hidden = trat.value !== "nao"); trat.addEventListener("change", ver); ver(); }
  }
  const lerCampos = (box) => {
    const campos = {};
    for (const c of box.querySelectorAll("[data-campo]")) if (!c.closest("label")?.hidden && c.value.trim()) campos[c.dataset.campo] = c.value.trim();
    return campos;
  };
  App.tarefasCampos = { CAMPOS, montarCampos, lerCampos, tipos: () => A.tipos };

  function renderFormTarefa() {
    if (!A.tipos) return;
    const chips = $("#at-tipos");
    if (!chips.childElementCount) chips.replaceChildren(...A.tipos.tipos.map((t) => el("button", { class: "chip tipo-chip", type: "button", "data-tipo": t.tipo,
      onclick: () => { F.tipo = t.tipo; renderFormTarefa(); $("#at-campos input, #at-campos select")?.focus(); } }, App.icTipo(t.tipo), t.nome)));
    chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.tipo === F.tipo)));
    montarCampos($("#at-campos"), F.tipo);
    $("#at-titulo-box").hidden = F.tipo !== "livre";
    const reg = F.modo === "registro";
    $("#at-modo").querySelectorAll("input").forEach((r) => (r.checked = r.value === F.modo));
    $("#at-para-box").hidden = reg; $("#at-prazo-box").hidden = reg;
    $("#at-para-equipe").hidden = reg || !["ativar_entregadores", "ativar_parceiro"].includes(F.tipo);  // 009z12
    $("#at-prazo-dica").textContent = `Vazio = prazo padrão do tipo (${horasTxt(tipoDe(F.tipo)?.prazo_horas)}).`;
    $("#at-enviar").textContent = reg ? "Registrar o que fiz" : "Criar tarefa";
  }
  $("#at-modo").addEventListener("change", (e) => { F.modo = e.target.value; renderFormTarefa(); });
  $("#at-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = $("#at-erro"); erro.hidden = true;
    const titulo = $("#at-titulo").value.trim();
    if (F.tipo === "livre" && !titulo) { erro.textContent = "Escreva o que precisa ser feito."; erro.hidden = false; return; }
    const campos = lerCampos($("#at-campos"));
    const reg = F.modo === "registro";
    const prazo = !reg && $("#at-prazo").value ? new Date($("#at-prazo").value).toISOString() : null;
    const para = reg ? [] : [...document.querySelectorAll("#at-para input:checked")].map((x) => x.value);
    const btn = $("#at-enviar"); btn.disabled = true;
    try {
      await rpc("criar_tarefa", { p_tipo: F.tipo, p_campos: campos, p_titulo: titulo || null, p_descricao: $("#at-descricao").value.trim() || null,
        p_para: para, p_prazo: prazo, p_modo: F.modo });
      ev.target.reset(); document.querySelectorAll("#at-para input").forEach((x) => (x.checked = false));
      $("#at-campos").dataset.tipo = ""; renderFormTarefa();
      $("#at-nova-box").open = false;
      toast(reg ? "Registrado: entrou nos seus números." : para.length ? "Tarefa criada. As pessoas escolhidas receberam um aviso." : "Tarefa criada para toda a equipe.");
      await App.carregar();
    } catch (e) { erro.textContent = msgErro(e); erro.hidden = false; }
    finally { btn.disabled = false; }
  });
  $("#at-proxima").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const a = await rpc("pegar_proxima");
      toast(a ? `Com você agora: ${a.titulo}` : "Nenhuma tarefa aberta para você agora.");
      await App.carregar();
    } catch (err) { toast(msgErro(err)); } finally { b.disabled = false; }
  });

  async function acaoAtividade(fn, args, btn, msg) {
    if (btn) btn.disabled = true;
    try { await rpc(fn, args); delete A.caixa["a" + args.p_id]; delete A.conf[args.p_id]; if (msg) toast(msg); await App.carregar(); }
    catch (e) { if (btn) btn.disabled = false; toast(msgErro(e)); await App.carregar(); }
  }

  // janelas: aguardando terceiro, pedir para alguém, comentários
  function janelaAguardar(a) {
    const mot = el("input", { maxlength: 300, placeholder: "Ex.: esperando o parceiro mandar os documentos" });
    const d = App.u.janela("Aguardando terceiro", el("p", { class: "meta", style: "margin-top:0", text: "O relógio da tarefa para e o prazo anda junto, até você retomar." }),
      el("label", {}, "Esperando o quê?", mot),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: async (e) => {
        if (!mot.value.trim()) return mot.focus();
        await acaoAtividade("aguardar_terceiro", { p_id: a.id, p_motivo: mot.value.trim() }, e.currentTarget, "Tarefa pausada."); d.close();
      } }, "Pausar"), el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    d.id = "janela-aguardar";
    setTimeout(() => mot.focus(), 30);
  }
  function janelaPedir(a) {
    const sel = el("select", { "aria-label": "Pessoa" }, el("option", { value: "", text: "Escolha a pessoa" }),
      ...S.pessoas.filter((p) => p.id !== S.me.id).map((p) => el("option", { value: p.id, text: p.nome })));
    const d = App.u.janela("Pedir para alguém", el("p", { style: "margin-top:0", text: a.titulo }), sel,
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: async (e) => {
        if (!sel.value) return sel.focus();
        await acaoAtividade("pedir_tarefa_para", { p_id: a.id, p_para: sel.value }, e.currentTarget, "Pedido enviado. A pessoa recebeu um aviso."); d.close();
      } }, "Pedir"), el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  async function janelaComentarios(a) {
    const lista = el("div", { class: "comentarios-tarefa" }, carregandoEl());
    const txt = el("textarea", { rows: 3, maxlength: 1000, placeholder: "Escreva… use @ e o nome para avisar alguém", id: "at-comentario" });
    const marcar = el("select", { "aria-label": "Marcar alguém", onchange: (e) => { if (e.target.value) { txt.value += (txt.value && !txt.value.endsWith(" ") ? " " : "") + "@" + e.target.value + " "; e.target.value = ""; txt.focus(); } } },
      el("option", { value: "", text: "@ Marcar alguém" }), ...S.pessoas.filter((p) => p.id !== S.me.id).map((p) => el("option", { value: p.nome, text: p.nome })));
    const carregar = async () => {
      const c = await rpc("comentarios_da_tarefa", { p_id: a.id });
      lista.replaceChildren(...(c.length ? c.map((x) => el("div", { class: "comentario" }, el("b", { text: x.por_nome }), el("span", { class: "meta", text: " · " + dt(x.em) }),
        el("div", { class: "rapido-texto", text: x.texto }))) : [el("p", { class: "meta", text: "Nenhum comentário ainda." })]));
    };
    const d = App.u.janela("Comentários: " + a.titulo, lista, txt,
      el("div", { class: "actions" }, marcar, el("button", { class: "btn primary", type: "button", onclick: async (e) => {
        const t = txt.value.trim(); if (!t) return txt.focus();
        const baixo = App.u.norm(t);
        const mencoes = S.pessoas.filter((p) => baixo.includes("@" + App.u.norm(p.nome))).map((p) => p.id);
        const b = e.currentTarget; b.disabled = true;
        try { await rpc("comentar_tarefa", { p_id: a.id, p_texto: t, p_mencoes: mencoes }); txt.value = ""; await carregar(); App.carregar(); }
        catch (err) { toast(msgErro(err)); } finally { b.disabled = false; }
      } }, "Comentar")));
    d.id = "janela-comentarios";
    carregar().catch((e) => lista.replaceChildren(el("p", { class: "warn-msg", text: msgErro(e) })));
  }

  function resumoCampos(a) {
    const c = a.campos || {}, mostrar = ["contato", "telefone", "pedido", "problema", "referencia", "motivo", "detalhe"];
    const partes = mostrar.filter((k) => c[k] && !(a.tipo === "contato_entregador" && k === "motivo")).map((k) => `${ROTULO_CAMPO[k] || k}: ${c[k]}`);
    if (c.id_app && App.abrirFicha) partes.unshift(null);
    return partes.length || c.id_app ? el("div", { class: "campos-tarefa" },
      c.id_app && App.abrirFicha ? el("button", { class: "link-ficha", type: "button", onclick: () => App.abrirFicha(c.id_app) }, "Ficha " + c.id_app) : null,
      ...partes.filter(Boolean).map((p) => el("span", { text: p }))) : null;
  }
  function blocoProgresso(a) {
    if (!a.meta) return null;
    return el("div", { class: "progresso-tarefa" },
      App.u.progresso(a.progresso, a.meta, `Progresso: ${a.progresso} de ${a.meta}`),  // 009l: <progress> nativo
      el("span", { class: "meta", text: `${a.progresso} de ${a.meta}${a.progresso_automatico ? (a.automatica ? ` (conta sozinho: ${a.tipo === "ativar_parceiro" ? "parceiros ativados" : "entregadores aprovados"} por qualquer pessoa da equipe, na cidade, desde que a tarefa foi criada)` : ` (conta sozinho: ${a.tipo === "ativar_parceiro" ? "parceiros ativados" : "entregadores aprovados"} por quem pegou, na cidade)`) : ""}${a.progresso >= a.meta ? ", meta atingida" : ""}` }),
      !a.progresso_automatico && a.pode_mexer && a.status !== "aberta" ? el("button", { class: "btn small", type: "button", onclick: (e) => acaoAtividade("avancar_tarefa", { p_id: a.id, p_delta: 1 }, e.currentTarget) }, "+1") : null,
      !a.progresso_automatico && a.pode_mexer && a.status !== "aberta" && a.progresso > 0 ? el("button", { class: "btn link", type: "button", onclick: (e) => acaoAtividade("avancar_tarefa", { p_id: a.id, p_delta: -1 }, e.currentTarget) }, "−1") : null);
  }
  function blocoChecklist(a) {
    const l = a.checklist || [];
    if (!l.length && !(a.status === "aceita" && a.pode_mexer)) return null;
    const feitos = l.filter((x) => x.feito).length;
    const novo = el("input", { maxlength: 200, placeholder: "Novo item", "aria-label": "Novo item do checklist" });
    const chave = "ck" + a.id;
    return el("details", { class: "checklist-tarefa", open: A.caixa[chave] ? true : null, ontoggle: (e) => { if (e.target.open) A.caixa[chave] = true; else delete A.caixa[chave]; } },
      el("summary", { text: l.length ? `Checklist ${feitos}/${l.length}` : "Checklist" }),
      el("ul", {}, l.map((x, i) => {
        const cb = el("input", { type: "checkbox", disabled: !a.pode_mexer || null }); cb.checked = !!x.feito;
        cb.addEventListener("change", () => { cb.blur(); acaoAtividade("checklist_tarefa", { p_id: a.id, p_acao: "marcar", p_indice: i }); });
        return el("li", {}, el("label", { class: "marcar" + (x.feito ? " feito" : "") }, cb, x.texto, x.feito && x.por_nome ? el("span", { class: "meta", text: ` · ${x.por_nome}` }) : null),
          a.pode_mexer ? el("button", { class: "btn link", type: "button", "aria-label": "Remover " + x.texto, onclick: () => acaoAtividade("checklist_tarefa", { p_id: a.id, p_acao: "remover", p_indice: i }) }, App.ic("fechar")) : null);
      })),
      a.pode_mexer ? el("form", { class: "actions", onsubmit: (e) => { e.preventDefault(); novo.blur(); if (novo.value.trim()) acaoAtividade("checklist_tarefa", { p_id: a.id, p_acao: "incluir", p_texto: novo.value.trim() }); } },
        novo, el("button", { class: "btn small", type: "submit" }, "Incluir")) : null);
  }

  function cartaoAtividade(a) {
    const espera = duracao(a.criada_em);
    const minAbrir = Math.max(0, 10 - Math.floor((Date.now() - new Date(a.criada_em)) / 60000));
    const para = !a.sugeridas_nomes.length ? "Para todos"
      : a.para_todos ? `Sugerida para ${a.sugeridas_nomes.join(", ")} · aberta para todos`
      : `Sugerida para ${a.sugeridas_nomes.join(", ")} · abre para todos em ${minAbrir} min`;
    const atrasada = a.atrasada;
    const cx = A.caixa["a" + a.id];
    const antesDaMeta = a.automatica && (a.progresso || 0) < (a.meta || 0);  // 009y1d: concluir a atividade da equipe antes da meta pede o motivo
    const nota = cx ? el("textarea", { rows: "2", maxlength: "600", placeholder: antesDaMeta ? "Por que concluir antes de bater a meta? (obrigatório)" : "Como ficou? (opcional)", "aria-label": "Nota da conclusão", oninput: (e) => (cx.texto = e.target.value) }) : null;
    if (nota) nota.value = cx.texto;
    const prevPassou = a.status === "aceita" && a.previsao && new Date(a.previsao) < Date.now();
    const minha = a.sou_participante;
    const quemEsta = (a.participantes?.length ? a.participantes : [a.aceita_por_nome]).map((n) => (n === S.me.nome ? "você" : n)).join(", ");
    const tempos = a.status === "aberta" ? null
      : a.modo === "registro" ? "Registro do que já foi feito"
      : a.status === "concluida" ? (a.seg_execucao == null ? null : `Esperou ${tempo(a.seg_espera)} até alguém pegar · levou ${tempo(a.seg_execucao)}`)
      : `Esperou ${tempo(a.seg_espera)} até alguém pegar · trabalhando há ${tempo(a.seg_execucao)}`;
    return el("article", { class: "card tarefa-card" + (a.opcional_para_mim && a.status === "aberta" ? " opcional" : "") + (a.status === "concluida" ? " tratada" : "") + (atrasada ? " atrasada" : "") + (prevPassou ? " previsao-passou" : "") + (a.aguardando_desde ? " aguardando" : ""), "data-id": a.id, "data-tipo": a.tipo },
      el("div", { class: "head" },
        el("span", { class: "name" }, a.tipo !== "livre" ? el("span", { class: "tag tipo" }, App.icTipo(a.tipo), a.tipo_nome) : null,
          a.opcional ? el("span", { class: "tag opcional", text: a.opcional_para_mim ? "Opcional" : "Opcional para os outros" }) : null,
          a.recorrente ? el("span", { class: "tag", title: "Tarefa que se repete" }, App.ic("recorrente", { rotulo: "Tarefa que se repete" })) : null, a.titulo),
        a.status === "aberta" ? el("span", { class: "esperando" + (espera.velho ? " velho" : ""), text: `esperando há ${espera.txt}` }) : null),
      resumoCampos(a),
      a.descricao ? el("div", { class: "obs", text: a.descricao }) : null,
      // 009j (cartão enxuto): quem criou, quando, cidade, para quem e prazo numa linha só
      el("div", { class: "meta linha-tarefa" },
        `Por ${a.criada_por === S.me.id ? "você" : a.criada_por_nome} · ${dt(a.criada_em)}${a.cidade ? " · " + a.cidade : ""}${a.modo === "registro" ? " · Registro do que já foi feito" : " · " + para}`,
        a.prazo && a.status !== "concluida" ? el("span", {}, " · Prazo: ", a.aguardando_desde ? "parado enquanto aguarda terceiro" : App.u.prazo(a.prazo, a.criada_em)) : null),  // 009z5 (A5-20)  // 009z (M2)
      a.aguardando_desde ? el("div", { class: "bullet aguardando" }, el("span", {}, el("b", { icone: "aguardando" }, "Aguardando terceiro"), ` desde ${dt(a.aguardando_desde)}: ${a.aguardando_motivo}`)) : null,
      a.status === "aceita" && !a.aguardando_desde ? el("div", { class: "bullet pendente" }, el("span", {}, el("b", { text: "Em andamento" }), ` com ${quemEsta} desde ${dt(a.aceita_em)}`, tempos ? el("span", { class: "meta tempos", icone: "tempo" }, tempos) : null)) : null,
      a.pode_entrar ? el("div", { class: "bullet juntos" }, el("span", {}, el("b", { icone: "juntos" }, "Já tem gente trabalhando nela"), ` (${quemEsta}). Dá para entrar junto: as suas aprovações também contam.`)) : null,
      a.status === "aceita" ? App.u.previsao(a, "atividade", a.id, a.pode_prever) : null,
      a.status === "concluida" ? el("div", { class: "bullet concluida" }, el("span", {}, el("b", { text: "Concluída" }), ` por ${a.concluida_por_nome} em ${dt(a.concluida_em)}${a.nota ? " — " + a.nota : ""}`,
        tempos && a.modo !== "registro" ? el("span", { class: "meta tempos", icone: "tempo" }, tempos) : null)) : null,
      a.aguardando_desde && tempos ? el("div", { class: "meta tempos", icone: "tempo" }, tempos) : null,
      blocoProgresso(a),
      blocoChecklist(a),
      a.agradecimentos.length ? el("div", { class: "meta agradecimentos", icone: "agradecer" }, "Agradeceram: " + a.agradecimentos.join(", ")) : null,
      a.revisao ? el("div", { class: "bullet " + (a.revisao.resultado === "ok" ? "concluida" : "atrasada") }, el("span", {},
        el("b", { icone: a.revisao.resultado === "ok" ? "ok" : "ajustar" }, a.revisao.resultado === "ok" ? "Revisada: tudo certo" : "Revisada: pediu ajuste"), ` por ${a.revisao.por_nome}${a.revisao.comentario ? " — " + a.revisao.comentario : ""}`)) : null,
      el("div", { class: "actions" },
        a.pode_aceitar ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, a.compartilhavel ? "Tarefa aceita. Outras pessoas ainda podem entrar junto." : "Tarefa aceita. Ela está com você.") }, "Eu faço") : null,
        a.pode_entrar ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Você entrou na tarefa. Suas aprovações contam junto.") }, [App.ic("juntos"), "Entrar junto"]) : null,
        a.status === "aberta" && !a.automatica ? el("button", { class: "btn small", type: "button", onclick: () => janelaPedir(a) }, "Pedir para alguém") : null,
        a.cadastro_id && a.status !== "concluida" ? el("button", { class: "btn small", type: "button", onclick: () => App.abrirCadastro(a.cadastro_id) }, "Completar o cadastro") : null,
        a.pode_concluir && !cx ? el("button", { class: "btn approve small", type: "button", onclick: () => { A.caixa["a" + a.id] = { texto: "" }; render(); } }, "Concluir") : null,
        cx ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("concluir_atividade", { p_id: a.id, p_nota: cx.texto || null }, e.currentTarget, "Tarefa concluída.") }, "Confirmar conclusão") : null,
        cx ? el("button", { class: "btn link", type: "button", onclick: () => { delete A.caixa["a" + a.id]; render(); } }, "Cancelar") : null,
        a.pode_concluir && !a.pode_entrar && !cx && !a.aguardando_desde ? el("button", { class: "btn small", type: "button", onclick: () => janelaAguardar(a), icone: "aguardando" }, "Aguardando terceiro") : null,
        a.pode_concluir && !a.pode_entrar && a.aguardando_desde ? el("button", { class: "btn small primary", type: "button", onclick: (e) => acaoAtividade("aguardar_terceiro", { p_id: a.id, p_motivo: null }, e.currentTarget, "Tarefa retomada.") }, [App.ic("tocar"), "Retomar"]) : null,
        el("button", { class: "btn small quiet", type: "button", onclick: () => janelaComentarios(a), icone: "comentario", "aria-label": `Comentários${a.comentarios ? " (" + a.comentarios + ")" : ""}` }, a.comentarios ? String(a.comentarios) : "Comentar"),
        a.pode_agradecer ? el("button", { class: "btn small quiet", type: "button", "aria-pressed": String(a.agradeci), onclick: (e) => acaoAtividade("agradecer_tarefa", { p_id: a.id }, e.currentTarget, a.agradeci ? null : "Agradecimento enviado.") }, [App.ic("agradecer"), a.agradeci ? "Agradecido" : "Agradecer"]) : null,
        el("span", { class: "spacer" }),
        a.pode_excluir && a.status !== "concluida" ? (A.conf[a.id]
          ? el("span", {}, el("button", { class: "btn danger small", type: "button", onclick: (e) => acaoAtividade("excluir_atividade", { p_id: a.id }, e.currentTarget, "Tarefa excluída.") }, "Confirmar exclusão"),
              el("button", { class: "btn link", type: "button", onclick: () => { delete A.conf[a.id]; render(); } }, "Cancelar"))
          : el("button", { class: "btn quiet small", type: "button", onclick: () => { A.conf[a.id] = true; render(); } }, "Excluir")) : null),
      nota);
  }

  // prazos padrão por tipo (moderador)
  function renderPrazos() {
    const box = $("#at-prazos");
    if (!A.tipos || S.me.papel !== "moderador") return box.replaceChildren();
    if (box.childElementCount) return;
    box.replaceChildren(el("details", { class: "panel" }, el("summary", {}, el("b", { text: "Prazos padrão por tipo" }), el("span", { class: "meta", text: " · só moderador" })),
      el("p", { class: "meta", text: "Tarefa criada sem prazo recebe o prazo do tipo. Sem dono na metade do prazo, os moderadores são avisados; passou do prazo, quem está com ela é avisado." }),
      el("div", { class: "prazos-tipos" }, A.tipos.tipos.map((t) => {
        const inp = el("input", { type: "number", min: "0.25", max: "720", step: "0.25", value: t.prazo_horas ?? "", placeholder: "sem prazo", "aria-label": "Prazo em horas: " + t.nome });
        return el("label", {}, t.nome, el("span", { class: "linha" }, inp, el("span", { class: "meta", text: "h" }),
          el("button", { class: "btn small", type: "button", onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try { await rpc("salvar_prazo_tipo_tarefa", { p_tipo: t.tipo, p_prazo_horas: inp.value === "" ? null : Number(inp.value) }); t.prazo_horas = inp.value === "" ? null : Number(inp.value); toast("Prazo salvo."); renderFormTarefa(); }
            catch (err) { toast(msgErro(err)); } finally { b.disabled = false; }
          } }, "Salvar")));
      }))));
  }

  function renderSugeridas() {
    preencherPessoas();
    renderFormTarefa();
    renderPrazos();
    App.painel?.renderRecorrentes();
    const box = $("#at-sug-lista"), l = A.atividades;
    if (!l) return box.replaceChildren(carregandoEl());
    const paraMim = (a) => !a.automatica && ((a.status === "aberta" && a.para_mim) || (a.status === "aceita" && a.sou_participante));
    const grupos = [
      // 009y1c (pedido do usuário): as que o sistema cria sozinho são de todos; ninguém precisa aceitar
      ["Atividades da equipe: todos participam", l.filter((a) => a.automatica && a.status !== "concluida")],
      ["Para você", l.filter(paraMim)],
      ["Abertas: quem puder, pega", l.filter((a) => !a.automatica && ((a.status === "aberta" && !a.para_mim) || a.pode_entrar)).sort((x, y) => String(x.prazo || "9").localeCompare(String(y.prazo || "9")) || String(x.criada_em).localeCompare(String(y.criada_em)))],
      ["Em andamento com a equipe", l.filter((a) => !a.automatica && a.status === "aceita" && !a.sou_participante && !a.pode_entrar)],
      ["Concluídas nos últimos 30 dias", l.filter((a) => a.status === "concluida").sort((x, y) => String(y.concluida_em).localeCompare(String(x.concluida_em))).slice(0, A.concLimite || 50)],
    ].filter(([, x]) => x.length);
    if (!grupos.length) return box.replaceChildren(vazio("Nenhuma tarefa", "Use “Nova tarefa” para pedir algo à equipe ou registrar o que você fez."));
    const temMais = l.filter((a) => a.status === "concluida").length > (A.concLimite || 50);
    // 009y2 (A3-13): grupos grandes (as abertas chegam a centenas) mostram 30 por vez, com "Mostrar mais"
    A.limGrupo = A.limGrupo || {};
    box.replaceChildren(...grupos.map(([tit, x]) => {
      const lim = tit.startsWith("Concluídas") ? x.length : (A.limGrupo[tit] || 30);
      return el("div", { class: "grupo" }, el("h3", {}, tit, el("span", { class: "count", text: x.length })), el("div", { class: "queue" }, x.slice(0, lim).map(cartaoAtividade)),
        x.length > lim ? el("button", { class: "btn link mais-pend", type: "button", onclick: () => { A.limGrupo[tit] = lim + 30; renderSugeridas(); } }, `Mostrar mais ${Math.min(30, x.length - lim)} (de ${x.length})`) : null);
    }),
      ...(temMais ? [el("div", { class: "paginas" }, el("button", { class: "btn small", type: "button",
        onclick: async (e) => { e.currentTarget.disabled = true; A.concLimite = (A.concLimite || 50) + 50;
          try { A.atividades = await listarAtividades(A.concLimite + 1); } catch (err) { return toast(msgErro(err)); } renderSugeridas(); } }, "Ver mais concluídas"))] : []));
  }


  // 009x (AT4): só as N concluídas mais recentes (pede uma a mais para saber se há "Ver mais"); 0 = nenhuma.
  const listarAtividades = (n) => rpc("listar_atividades", { p_concluidas: n });
  App.listarAtividades = listarAtividades;

  App.modulo({
    id: "atividades", nome: "Atividades",
    abas: [
      { id: "pendencias", nome: "Minha fila", secao: "v-at-pendencias", contador: "c-at-pend", alerta: true },  // 009m: antes "Pendências"
      { id: "sugeridas", nome: "Tarefas", secao: "v-at-sugeridas", contador: "c-at-sug", alerta: true },
      // 009m: o Painel foi para as Análises (aba "Tarefas") e os Avisos viraram item do menu de cima
    ],
    async carregarTipos() { A.tipos = await rpc("tipos_tarefa"); },
    async carregar(aba) {
      await Promise.all([
        aba === "sugeridas" ? App.painel.carregarRecorrentes() : null,
        aba === "pendencias" && S.me.papel_bloqueios ? rpc("listar_tarefas", { p_status: "pendente", p_minhas: staffBloq() }).then((d) => (A.tarefas = d)) : null,  // 009z5 (A2-20): p_minhas só para quem trata; o suporte acompanha as que registrou
        aba === "pendencias" && S.me.papel_bloqueios ? rpc("meus_lembretes").then((d) => (A.lembretes = d)).catch(() => (A.lembretes = [])) : null,  // 009z4 (NF-9)
        listarAtividades(aba === "sugeridas" ? (A.concLimite || 50) + 1 : 0).then((d) => (A.atividades = d)),
        aba === "sugeridas" && !A.tipos ? rpc("tipos_tarefa").then((d) => (A.tipos = d)) : null,
      ]);
    },
    render(aba) { ({ sugeridas: renderSugeridas, pendencias: renderPendencias })[aba]?.(); },
    contadores() {
      App.contador("c-at-pend", totalPendencias() || 0);
      // 009v: as tarefas em aberto (sem dono, não criadas por mim) também contam; sem a 009v no banco, fica o para_aceitar
      const at = S.resumo?.atividades || {}, abertas = at.abertas_para_pegar ?? at.para_aceitar ?? 0;
      App.contador("c-at-menu", (totalPendencias() || 0) - (at.para_aceitar || 0) + abertas);   // 009u: o número também no menu
      App.contador("c-at-sug", abertas);
    },
    totalPendencias,
  });
})();
