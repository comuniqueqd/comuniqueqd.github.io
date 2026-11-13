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
        acoes: [el("button", { class: "btn small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Tarefa aceita. Ela está com você.") }, "Pegar"),
          a.cadastro_id ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirCadastro(a.cadastro_id) }, "Completar agora") : null].filter(Boolean) }));
    // os "revisar" dos bloqueios (vindos da planilha): um cartão só, opcional
    const nRev = S.resumo?.bloqueios_revisar || 0;
    if (S.me.papel_bloqueios && nRev)
      opcionais.push(item({ modulo: "BLOQUEIOS", opcional: true, titulo: `Revisar registros da planilha: faltam ${nRev}`,
        detalhe: "Bloqueios com a marca “revisar” (dados conflitantes da importação). Cada um corrigido ou conferido sai da conta.",
        acoes: [el("button", { class: "btn small", type: "button", onclick: () => App.bloqueios?.abrirRevisar?.() }, "Abrir os registros para revisar")] }));
    // Atividades sugeridas: para aceitar e as que você aceitou
    for (const a of A.atividades.filter((x) => (x.status === "aberta" && x.pode_aceitar && !x.opcional_para_mim && x.criada_por !== S.me.id) || (x.status === "aceita" && x.sou_participante)))
      itens.push(item({ modulo: "ATIVIDADE", titulo: a.titulo, estado: a.status === "aceita" ? "concluida" : "pendente",
        detalhe: a.status === "aceita" ? `${a.participantes?.length > 1 ? "Com " + a.participantes.join(", ") + " · " : ""}Você está nela; aceita há ${duracao(a.aceita_em).txt}${a.prazo ? " · prazo " + dt(a.prazo) : ""}.`
          : `Sugerida por ${a.criada_por_nome} há ${duracao(a.criada_em).txt}${a.para_mim ? " para você" : ""}, esperando alguém aceitar.`,
        acoes: [el("a", { class: "btn small", href: "#atividades/sugeridas" }, a.status === "aceita" ? "Concluir" : "Ver e aceitar"),
          a.cadastro_id ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirCadastro(a.cadastro_id) }, "Completar o cadastro") : null].filter(Boolean),
        extra: a.status === "aceita" ? App.u.previsao(a, "atividade", a.id, a.pode_prever) : null }));
    // Pedidos para ser responsável de cidade (moderadores, 008b)
    itens.push(...App.avisos.cartoesPedidos(item));
    // Ativação
    if (staffAtiv() && r.ativacao.aguardando_analise)
      itens.push(item({ modulo: "ATIVAÇÃO", titulo: `${r.ativacao.aguardando_analise} cadastro(s) aguardando análise`,
        detalhe: "Aprovar, reprovar ou encerrar.", acoes: [el("a", { class: "btn primary small", href: "#ativacao/pendentes" }, "Abrir pendentes")] }));
    if (!staffAtiv() && (r.ativacao.aguardando_analise || r.ativacao.aguardando_contato))
      itens.push(item({ modulo: "ATIVAÇÃO", titulo: "Seus cadastros em andamento", estado: "sem",
        detalhe: `${r.ativacao.aguardando_analise} aguardando análise · ${r.ativacao.aguardando_contato} aguardando novo contato. Você acompanha, quem decide é o responsável.`,
        acoes: [el("a", { class: "btn small", href: "#ativacao/pendentes" }, "Acompanhar")] }));
    // Bloqueios
    for (const t of A.tarefas || []) {
      const b = t.bloqueio;
      const tipo = App.bloqueios.TAREFA[t.tipo] || "Tratativa";
      if (t.tipo === "completar_dados") {
        if (staffBloq()) itens.push(item({ modulo: "BLOQUEIOS", titulo: `${tipo}: ID ${b.id_app}`,
          detalhe: `Registrado só com o ID (${b.infracao}) por ${b.registrado_por_nome} há ${duracao(t.criada_em).txt}. Falta nome e cidade.`,
          acoes: [el("a", { class: "btn approve small", href: "#bloqueios/tratativas" }, "Completar na tela de tratativas")] }));
        continue;
      }
      const punicao = App.bloqueios.horasTxt(b.horas);
      const atraso = t.atrasada ? `Atrasada há ${duracao(t.criada_em).txt} (prazo ${t.prazo_horas} h) · ` : "";
      if (staffBloq() && t.minha) {
        const cx = A.caixa[t.id];
        const nota = cx ? el("textarea", { rows: "2", maxlength: "600", placeholder: "O que foi feito? (opcional)", "aria-label": "Nota da tratativa", oninput: (e) => (cx.texto = e.target.value) }) : null;
        if (nota) nota.value = cx.texto;
        itens.push(item({ modulo: "BLOQUEIOS", titulo: `${tipo}: ${b.nome}`, estado: t.atrasada ? "atrasada" : "pendente", atrasada: t.atrasada,
          detalhe: `${atraso}${b.infracao} · ${App.bloqueios.ord(b.ocorrencia)} ocorrência · ${punicao} · ${b.cidade || "sem cidade"} · com ${t.responsavel_nome} · registrado por ${b.registrado_por_nome} há ${duracao(t.criada_em).txt}`,
          acoes: [cx
            ? el("button", { class: "btn approve small", type: "button", onclick: (e) => App.bloqueios.concluir(t.id, cx.texto, e.currentTarget).then(() => { delete A.caixa[t.id]; }) }, "Confirmar")
            : el("button", { class: "btn approve small", type: "button", onclick: () => { A.caixa[t.id] = { texto: "" }; render(); } }, "Marcar como resolvida"),
            cx ? el("button", { class: "btn link", type: "button", onclick: () => { delete A.caixa[t.id]; render(); } }, "Cancelar") : null,
            S.me.papel_bloqueios === "moderador" ? el("button", { class: "btn link", type: "button", onclick: () => App.bloqueios.realocar(t, b) }, "Realocar…") : null,
            el("a", { class: "btn link", href: "#bloqueios/tratativas" }, "Ver na tela de tratativas")].filter(Boolean),
          extra: el("div", {}, App.u.previsao(t, "tarefa", t.id, true),
            cx ? el("div", { class: "box" }, el("p", { class: "meta", style: "margin:0", text: "Resolver a tratativa não libera o bloqueio. Quem registrou recebe um aviso." }), nota) : null) }));
      } else if (!staffBloq()) {
        itens.push(item({ modulo: "BLOQUEIOS", titulo: `Acompanhando: ${tipo.toLowerCase()} de ${b.nome}`, estado: "pendente",
          detalhe: `Pendente com ${t.responsavel_nome} há ${duracao(t.criada_em).txt} · ${b.infracao} · ${punicao}`,
          extra: App.u.previsao(t, "tarefa", t.id, false),
          acoes: [el("a", { class: "btn small", href: "#bloqueios/historico" }, "Ver no Histórico")] }));
      }
    }
    if (!itens.length && !opcionais.length) return box.replaceChildren(vazio("Tudo em dia", "Nenhuma pendência para você agora. Novas tarefas aparecem aqui assim que forem criadas."));
    box.replaceChildren(...[
      itens.length ? el("ul", { class: "queue", style: "padding:0;margin:0" }, itens) : vazio("Tudo em dia", "Nenhuma pendência só sua agora."),
      opcionais.length ? el("div", { class: "grupo" }, el("h3", {}, "Opcionais: quem puder, pega", el("span", { class: "count", text: opcionais.length })),
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
      onclick: () => { F.tipo = t.tipo; renderFormTarefa(); $("#at-campos input, #at-campos select")?.focus(); } }, `${t.icone || ""} ${t.nome}`)));
    chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.tipo === F.tipo)));
    montarCampos($("#at-campos"), F.tipo);
    $("#at-titulo-box").hidden = F.tipo !== "livre";
    const reg = F.modo === "registro";
    $("#at-modo").querySelectorAll("input").forEach((r) => (r.checked = r.value === F.modo));
    $("#at-para-box").hidden = reg; $("#at-prazo-box").hidden = reg;
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
      toast(a ? `Com você agora: ${a.titulo}` : "Nenhuma tarefa aberta para você agora. 🎉");
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
      el("span", { class: "meta", text: `${a.progresso} de ${a.meta}${a.progresso_automatico ? (a.tipo === "ativar_parceiro" ? " (conta sozinho: parceiros ativados por quem pegou, na cidade)" : " (conta sozinho: entregadores aprovados por quem pegou, na cidade)") : ""}${a.progresso >= a.meta ? " · meta atingida 🎉" : ""}` }),
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
          a.pode_mexer ? el("button", { class: "btn link", type: "button", "aria-label": "Remover " + x.texto, onclick: () => acaoAtividade("checklist_tarefa", { p_id: a.id, p_acao: "remover", p_indice: i }) }, "✕") : null);
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
    const nota = cx ? el("textarea", { rows: "2", maxlength: "600", placeholder: "Como ficou? (opcional)", "aria-label": "Nota da conclusão", oninput: (e) => (cx.texto = e.target.value) }) : null;
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
        el("span", { class: "name" }, a.tipo !== "livre" ? el("span", { class: "tag tipo", text: `${a.tipo_icone} ${a.tipo_nome}` }) : null,
          a.opcional ? el("span", { class: "tag opcional", text: a.opcional_para_mim ? "Opcional" : "Opcional para os outros" }) : null,
          a.recorrente ? el("span", { class: "tag", title: "Tarefa que se repete", text: "🔁" }) : null, a.titulo),
        a.status === "aberta" ? el("span", { class: "esperando" + (espera.velho ? " velho" : ""), text: `esperando há ${espera.txt}` }) : null),
      resumoCampos(a),
      a.descricao ? el("div", { class: "obs", text: a.descricao }) : null,
      // 009j (cartão enxuto): quem criou, quando, cidade, para quem e prazo numa linha só
      el("div", { class: "meta linha-tarefa" },
        `Por ${a.criada_por === S.me.id ? "você" : a.criada_por_nome} · ${dt(a.criada_em)}${a.cidade ? " · " + a.cidade : ""}${a.modo === "registro" ? " · Registro do que já foi feito" : " · " + para}`,
        a.prazo && a.status !== "concluida" ? el("span", { class: atrasada ? "err" : null, text: ` · Prazo: ${dt(a.prazo)}${atrasada ? " (passou)" : ""}` }) : null),
      a.aguardando_desde ? el("div", { class: "bullet aguardando" }, el("span", {}, el("b", { text: "⏳ Aguardando terceiro" }), ` desde ${dt(a.aguardando_desde)}: ${a.aguardando_motivo}`)) : null,
      a.status === "aceita" && !a.aguardando_desde ? el("div", { class: "bullet pendente" }, el("span", {}, el("b", { text: "Em andamento" }), ` com ${quemEsta} desde ${dt(a.aceita_em)}`, tempos ? el("span", { class: "meta tempos", text: " · ⏱ " + tempos }) : null)) : null,
      a.pode_entrar ? el("div", { class: "bullet juntos" }, el("span", {}, el("b", { text: "🤝 Já tem gente trabalhando nela" }), ` (${quemEsta}). Dá para entrar junto: as suas aprovações também contam.`)) : null,
      a.status === "aceita" ? App.u.previsao(a, "atividade", a.id, a.pode_prever) : null,
      a.status === "concluida" ? el("div", { class: "bullet concluida" }, el("span", {}, el("b", { text: "Concluída" }), ` por ${a.concluida_por_nome} em ${dt(a.concluida_em)}${a.nota ? " — " + a.nota : ""}`,
        tempos && a.modo !== "registro" ? el("span", { class: "meta tempos", text: " · ⏱ " + tempos }) : null)) : null,
      a.aguardando_desde && tempos ? el("div", { class: "meta tempos", text: "⏱ " + tempos }) : null,
      blocoProgresso(a),
      blocoChecklist(a),
      a.agradecimentos.length ? el("div", { class: "meta agradecimentos", text: "👏 " + a.agradecimentos.join(", ") }) : null,
      a.revisao ? el("div", { class: "bullet " + (a.revisao.resultado === "ok" ? "concluida" : "atrasada") }, el("span", {},
        el("b", { text: a.revisao.resultado === "ok" ? "✅ Revisada: tudo certo" : "✏️ Revisada: pediu ajuste" }), ` por ${a.revisao.por_nome}${a.revisao.comentario ? " — " + a.revisao.comentario : ""}`)) : null,
      el("div", { class: "actions" },
        a.pode_aceitar ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, a.compartilhavel ? "Tarefa aceita. Outras pessoas ainda podem entrar junto." : "Tarefa aceita. Ela está com você.") }, "Eu faço") : null,
        a.pode_entrar ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Você entrou na tarefa. Suas aprovações contam junto.") }, "🤝 Entrar junto") : null,
        a.status === "aberta" ? el("button", { class: "btn small", type: "button", onclick: () => janelaPedir(a) }, "Pedir para alguém") : null,
        a.cadastro_id && a.status !== "concluida" ? el("button", { class: "btn small", type: "button", onclick: () => App.abrirCadastro(a.cadastro_id) }, "Completar o cadastro") : null,
        a.pode_concluir && !cx ? el("button", { class: "btn approve small", type: "button", onclick: () => { A.caixa["a" + a.id] = { texto: "" }; render(); } }, "Concluir") : null,
        cx ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("concluir_atividade", { p_id: a.id, p_nota: cx.texto || null }, e.currentTarget, "Tarefa concluída.") }, "Confirmar conclusão") : null,
        cx ? el("button", { class: "btn link", type: "button", onclick: () => { delete A.caixa["a" + a.id]; render(); } }, "Cancelar") : null,
        a.pode_concluir && !a.pode_entrar && !cx && !a.aguardando_desde ? el("button", { class: "btn small", type: "button", onclick: () => janelaAguardar(a) }, "⏳ Aguardando terceiro") : null,
        a.pode_concluir && !a.pode_entrar && a.aguardando_desde ? el("button", { class: "btn small primary", type: "button", onclick: (e) => acaoAtividade("aguardar_terceiro", { p_id: a.id, p_motivo: null }, e.currentTarget, "Tarefa retomada.") }, "▶ Retomar") : null,
        el("button", { class: "btn small quiet", type: "button", onclick: () => janelaComentarios(a) }, `💬 ${a.comentarios || ""}`.trim()),
        a.pode_agradecer ? el("button", { class: "btn small quiet", type: "button", "aria-pressed": String(a.agradeci), onclick: (e) => acaoAtividade("agradecer_tarefa", { p_id: a.id }, e.currentTarget, a.agradeci ? null : "Agradecimento enviado.") }, a.agradeci ? "👏 Agradecido" : "👏 Agradecer") : null,
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
        return el("label", {}, `${t.icone || ""} ${t.nome}`, el("span", { class: "linha" }, inp, el("span", { class: "meta", text: "h" }),
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
    const paraMim = (a) => (a.status === "aberta" && a.para_mim) || (a.status === "aceita" && a.sou_participante);
    const grupos = [
      ["Para você", l.filter(paraMim)],
      ["Abertas: quem puder, pega", l.filter((a) => (a.status === "aberta" && !a.para_mim) || a.pode_entrar).sort((x, y) => String(x.prazo || "9").localeCompare(String(y.prazo || "9")) || String(x.criada_em).localeCompare(String(y.criada_em)))],
      ["Em andamento com a equipe", l.filter((a) => a.status === "aceita" && !a.sou_participante && !a.pode_entrar)],
      ["Concluídas nos últimos 30 dias", l.filter((a) => a.status === "concluida").sort((x, y) => String(y.concluida_em).localeCompare(String(x.concluida_em)))],
    ].filter(([, x]) => x.length);
    if (!grupos.length) return box.replaceChildren(vazio("Nenhuma tarefa", "Use “Nova tarefa” para pedir algo à equipe ou registrar o que você fez."));
    box.replaceChildren(...grupos.map(([tit, x]) => el("div", { class: "grupo" }, el("h3", {}, tit, el("span", { class: "count", text: x.length })), el("div", { class: "queue" }, x.map(cartaoAtividade)))));
  }


  App.modulo({
    id: "atividades", nome: "Atividades",
    abas: [
      { id: "pendencias", nome: "Pendências", secao: "v-at-pendencias", contador: "c-at-pend", alerta: true },
      { id: "sugeridas", nome: "Tarefas", secao: "v-at-sugeridas", contador: "c-at-sug", alerta: true },
      { id: "painel", nome: "Painel", secao: "v-at-painel" },
      { id: "avisos", nome: "Avisos", secao: "v-at-avisos", contador: "c-at-avisos", alerta: true },
    ],
    async carregarTipos() { A.tipos = await rpc("tipos_tarefa"); },
    async carregar(aba) {
      if (aba === "painel") return App.painel.carregar();
      await Promise.all([
        aba === "sugeridas" ? App.painel.carregarRecorrentes() : null,
        aba === "pendencias" && S.me.papel_bloqueios ? rpc("listar_tarefas", { p_status: "pendente" }).then((d) => (A.tarefas = d)) : null,
        aba !== "avisos" ? rpc("listar_atividades").then((d) => (A.atividades = d)) : App.avisos.carregar(),
        aba === "sugeridas" && !A.tipos ? rpc("tipos_tarefa").then((d) => (A.tipos = d)) : null,
      ]);
    },
    render(aba) { ({ avisos: () => App.avisos.render(), sugeridas: renderSugeridas, pendencias: renderPendencias, painel: () => App.painel.render() })[aba]?.(); },
    contadores() {
      App.contador("c-at-pend", totalPendencias() || 0);
      App.contador("c-at-sug", S.resumo?.atividades?.para_aceitar || 0);
      App.contador("c-at-avisos", S.notif?.nao_lidas || 0);
    },
    totalPendencias,
  });
})();
