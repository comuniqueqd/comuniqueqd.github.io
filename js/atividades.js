// Módulo "Atividades": a caixa de entrada de cada pessoa. Junta as pendências dos dois módulos
// (cadastros para analisar, tratativas de bloqueio) e os avisos recebidos.
// As tarefas de bloqueio vêm da tabela "tarefas"; as da ativação, dos números de cadastros;
// as atividades sugeridas (qualquer pessoa cria, alguém aceita), da tabela "atividades".
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, duracao, toast, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const A = { tarefas: null, atividades: null, caixa: {}, marcando: false, conf: {} };
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
    if (staffBloq() && nRev)
      opcionais.push(item({ modulo: "BLOQUEIOS", opcional: true, titulo: `Revisar registros da planilha: faltam ${nRev}`,
        detalhe: "Bloqueios com a marca “revisar” (dados conflitantes da importação). Cada um corrigido ou conferido sai da conta.",
        acoes: [el("button", { class: "btn small", type: "button", onclick: () => App.bloqueios?.abrirRevisar?.() }, "Abrir os registros para revisar")] }));
    // Atividades sugeridas: para aceitar e as que você aceitou
    for (const a of A.atividades.filter((x) => (x.status === "aberta" && x.pode_aceitar && !x.opcional_para_mim && x.criada_por !== S.me.id) || (x.status === "aceita" && x.aceita_por === S.me.id)))
      itens.push(item({ modulo: "ATIVIDADE", titulo: a.titulo, estado: a.status === "aceita" ? "concluida" : "pendente",
        detalhe: a.status === "aceita" ? `Você aceitou há ${duracao(a.aceita_em).txt}${a.prazo ? " · prazo " + dt(a.prazo) : ""}.`
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
  $("#at-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = $("#at-erro"); erro.hidden = true;
    const titulo = $("#at-titulo").value.trim();
    if (!titulo) { erro.textContent = "Escreva o que precisa ser feito."; erro.hidden = false; return; }
    const prazo = $("#at-prazo").value ? new Date($("#at-prazo").value).toISOString() : null;
    const para = [...document.querySelectorAll("#at-para input:checked")].map((x) => x.value);
    const btn = $("#at-enviar"); btn.disabled = true;
    try {
      await rpc("sugerir_atividade", { p_titulo: titulo, p_descricao: $("#at-descricao").value.trim() || null, p_para: para, p_prazo: prazo });
      ev.target.reset(); document.querySelectorAll("#at-para input").forEach((x) => (x.checked = false));
      $("#at-nova-box").open = false;
      toast(para.length ? "Atividade sugerida. As pessoas escolhidas receberam um aviso." : "Atividade sugerida para todos.");
      await App.carregar();
    } catch (e) { erro.textContent = msgErro(e); erro.hidden = false; }
    finally { btn.disabled = false; }
  });
  async function acaoAtividade(fn, args, btn, msg) {
    btn.disabled = true;
    try { await rpc(fn, args); delete A.caixa["a" + args.p_id]; delete A.conf[args.p_id]; toast(msg); await App.carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); await App.carregar(); }
  }
  function cartaoAtividade(a) {
    const espera = duracao(a.criada_em);
    const minAbrir = Math.max(0, 10 - Math.floor((Date.now() - new Date(a.criada_em)) / 60000));
    const para = !a.sugeridas_nomes.length ? "Para todos"
      : a.para_todos ? `Sugerida para ${a.sugeridas_nomes.join(", ")} · aberta para todos`
      : `Sugerida para ${a.sugeridas_nomes.join(", ")} · abre para todos em ${minAbrir} min`;
    const atrasada = a.prazo && a.status !== "concluida" && new Date(a.prazo) < Date.now();
    const cx = A.caixa["a" + a.id];
    const nota = cx ? el("textarea", { rows: "2", maxlength: "600", placeholder: "Como ficou? (opcional)", "aria-label": "Nota da conclusão", oninput: (e) => (cx.texto = e.target.value) }) : null;
    if (nota) nota.value = cx.texto;
    const prevPassou = a.status === "aceita" && a.previsao && new Date(a.previsao) < Date.now();
    return el("article", { class: "card" + (a.opcional_para_mim && a.status === "aberta" ? " opcional" : "") + (a.status === "concluida" ? " tratada" : "") + (atrasada ? " atrasada" : "") + (prevPassou ? " previsao-passou" : ""), "data-id": a.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, a.opcional ? el("span", { class: "tag opcional", text: a.opcional_para_mim ? "Opcional" : "Opcional para os outros" }) : null, a.titulo),
        a.status === "aberta" ? el("span", { class: "esperando" + (espera.velho ? " velho" : ""), text: `esperando há ${espera.txt}` }) : null),
      a.descricao ? el("div", { class: "obs", text: a.descricao }) : null,
      el("div", { class: "meta", text: `Criada por ${a.criada_por === S.me.id ? "você" : a.criada_por_nome} em ${dt(a.criada_em)} · ${para}` }),
      a.prazo ? el("div", { class: "meta" + (atrasada ? " err" : ""), text: `Prazo: ${dt(a.prazo)}${atrasada ? " (passou)" : ""}` }) : null,
      a.status === "aceita" ? el("div", { class: "bullet pendente" }, el("span", {}, el("b", { text: "Em andamento" }), ` com ${a.aceita_por === S.me.id ? "você" : a.aceita_por_nome} desde ${dt(a.aceita_em)}`)) : null,
      a.status === "aceita" ? App.u.previsao(a, "atividade", a.id, a.pode_prever) : null,
      a.status === "concluida" ? el("div", { class: "bullet concluida" }, el("span", {}, el("b", { text: "Concluída" }), ` por ${a.concluida_por_nome} em ${dt(a.concluida_em)}${a.nota ? " — " + a.nota : ""}`)) : null,
      el("div", { class: "actions" },
        a.pode_aceitar ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Atividade aceita. Ela está com você.") }, "Aceitar") : null,
        a.cadastro_id && a.status !== "concluida" ? el("button", { class: "btn small", type: "button", onclick: () => App.abrirCadastro(a.cadastro_id) }, "Completar o cadastro") : null,
        a.pode_concluir && !cx ? el("button", { class: "btn approve small", type: "button", onclick: () => { A.caixa["a" + a.id] = { texto: "" }; render(); } }, "Concluir") : null,
        cx ? el("button", { class: "btn approve small", type: "button", onclick: (e) => acaoAtividade("concluir_atividade", { p_id: a.id, p_nota: cx.texto || null }, e.currentTarget, "Atividade concluída.") }, "Confirmar conclusão") : null,
        cx ? el("button", { class: "btn link", type: "button", onclick: () => { delete A.caixa["a" + a.id]; render(); } }, "Cancelar") : null,
        el("span", { class: "spacer" }),
        a.pode_excluir && a.status !== "concluida" ? (A.conf[a.id]
          ? el("span", {}, el("button", { class: "btn danger small", type: "button", onclick: (e) => acaoAtividade("excluir_atividade", { p_id: a.id }, e.currentTarget, "Atividade excluída.") }, "Confirmar exclusão"),
              el("button", { class: "btn link", type: "button", onclick: () => { delete A.conf[a.id]; render(); } }, "Cancelar"))
          : el("button", { class: "btn quiet small", type: "button", onclick: () => { A.conf[a.id] = true; render(); } }, "Excluir")) : null),
      nota);
  }
  function renderSugeridas() {
    preencherPessoas();
    const box = $("#at-sug-lista"), l = A.atividades;
    if (!l) return box.replaceChildren(carregandoEl());
    const grupos = [
      ["Esperando alguém aceitar", l.filter((a) => a.status === "aberta").sort((x, y) => String(x.criada_em).localeCompare(String(y.criada_em)))],
      ["Em andamento", l.filter((a) => a.status === "aceita")],
      ["Concluídas nos últimos 30 dias", l.filter((a) => a.status === "concluida").sort((x, y) => String(y.concluida_em).localeCompare(String(x.concluida_em)))],
    ].filter(([, x]) => x.length);
    if (!grupos.length) return box.replaceChildren(vazio("Nenhuma atividade sugerida", "Use “Sugerir atividade” para pedir algo à equipe."));
    box.replaceChildren(...grupos.map(([tit, x]) => el("div", { class: "grupo" }, el("h3", {}, tit, el("span", { class: "count", text: x.length })), el("div", { class: "queue" }, x.map(cartaoAtividade)))));
  }


  App.modulo({
    id: "atividades", nome: "Atividades",
    abas: [
      { id: "pendencias", nome: "Pendências", secao: "v-at-pendencias", contador: "c-at-pend", alerta: true },
      { id: "sugeridas", nome: "Atividades sugeridas", secao: "v-at-sugeridas", contador: "c-at-sug", alerta: true },
      { id: "avisos", nome: "Avisos", secao: "v-at-avisos", contador: "c-at-avisos", alerta: true },
    ],
    async carregar(aba) {
      await Promise.all([
        aba === "pendencias" && S.me.papel_bloqueios ? rpc("listar_tarefas", { p_status: "pendente" }).then((d) => (A.tarefas = d)) : null,
        aba !== "avisos" ? rpc("listar_atividades").then((d) => (A.atividades = d)) : App.avisos.carregar(),
      ]);
    },
    render(aba) { ({ avisos: () => App.avisos.render(), sugeridas: renderSugeridas, pendencias: renderPendencias })[aba]?.(); },
    contadores() {
      App.contador("c-at-pend", totalPendencias() || 0);
      App.contador("c-at-sug", S.resumo?.atividades?.para_aceitar || 0);
      App.contador("c-at-avisos", S.notif?.nao_lidas || 0);
    },
    totalPendencias,
  });
})();
