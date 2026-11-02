// Módulo "Atividades": a caixa de entrada de cada pessoa. Junta as pendências dos dois módulos
// (cadastros para analisar, tratativas de bloqueio) e os avisos recebidos.
// Primeira versão: as tarefas de bloqueio vêm da tabela "tarefas"; as da ativação, dos números de cadastros.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, duracao, toast, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const A = { tarefas: null, caixa: {}, marcando: false };
  const staffAtiv = () => ["moderador", "monitorador"].includes(S.me?.papel);
  const staffBloq = () => ["moderador", "monitorador"].includes(S.me?.papel_bloqueios);
  const render = () => App.render();

  function totalPendencias() {
    const r = S.resumo;
    if (!r) return null;
    return (staffAtiv() ? r.ativacao.aguardando_analise : 0) + (staffBloq() ? r.bloqueios?.tratativas_pendentes || 0 : 0);
  }

  function item({ modulo, titulo, detalhe, acoes = [], extra = null, estado = "pendente" }) {
    return el("li", { class: "card", style: "list-style:none" },
      el("div", { class: "head" }, el("span", { class: "name" }, el("span", { class: "tag", text: modulo }), titulo)),
      detalhe ? el("div", { class: "bullet " + estado, text: detalhe }) : null,
      acoes.length ? el("div", { class: "actions" }, acoes) : null,
      extra);
  }

  function renderPendencias() {
    const box = $("#at-lista");
    const r = S.resumo;
    if (!r || (S.me.papel_bloqueios && !A.tarefas)) return box.replaceChildren(carregandoEl());
    const itens = [];
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
      if (staffBloq() && t.minha) {
        const cx = A.caixa[t.id];
        const nota = cx ? el("textarea", { rows: "2", maxlength: "600", placeholder: "O que foi feito? (opcional)", "aria-label": "Nota da tratativa", oninput: (e) => (cx.texto = e.target.value) }) : null;
        if (nota) nota.value = cx.texto;
        itens.push(item({ modulo: "BLOQUEIOS", titulo: `${tipo}: ${b.nome}`,
          detalhe: `${b.infracao} · ${App.bloqueios.ord(b.ocorrencia)} ocorrência · ${punicao} · ${b.cidade || "sem cidade"} · registrado por ${b.registrado_por_nome} há ${duracao(t.criada_em).txt}`,
          acoes: [cx
            ? el("button", { class: "btn approve small", type: "button", onclick: (e) => App.bloqueios.concluir(t.id, cx.texto, e.currentTarget).then(() => { delete A.caixa[t.id]; }) }, "Confirmar")
            : el("button", { class: "btn approve small", type: "button", onclick: () => { A.caixa[t.id] = { texto: "" }; render(); } }, "Marcar como resolvida"),
            cx ? el("button", { class: "btn link", type: "button", onclick: () => { delete A.caixa[t.id]; render(); } }, "Cancelar") : null,
            el("a", { class: "btn link", href: "#bloqueios/tratativas" }, "Ver na tela de tratativas")].filter(Boolean),
          extra: cx ? el("div", { class: "box" }, el("p", { class: "meta", style: "margin:0", text: "Resolver a tratativa não libera o bloqueio. Quem registrou recebe um aviso." }), nota) : null }));
      } else if (!staffBloq()) {
        itens.push(item({ modulo: "BLOQUEIOS", titulo: `Acompanhando: ${tipo.toLowerCase()} de ${b.nome}`, estado: "pendente",
          detalhe: `Pendente com ${t.responsavel_nome} há ${duracao(t.criada_em).txt} · ${b.infracao} · ${punicao}`,
          acoes: [el("a", { class: "btn small", href: "#bloqueios/meus" }, "Meus registros")] }));
      }
    }
    if (!itens.length) return box.replaceChildren(vazio("Tudo em dia", "Nenhuma pendência para você agora. Novas tarefas aparecem aqui assim que forem criadas."));
    box.replaceChildren(el("ul", { class: "queue", style: "padding:0;margin:0" }, itens));
  }

  function renderAvisos() {
    const box = $("#at-avisos");
    const n = S.notif;
    if (!n) return box.replaceChildren(carregandoEl());
    if (!n.itens.length) return box.replaceChildren(vazio("Nenhum aviso", "Quando uma tratativa dos seus bloqueios for feita, ou um bloqueio for liberado antes do prazo, você recebe um aviso aqui."));
    box.replaceChildren(el("ul", { class: "queue", style: "padding:0;margin:0" }, n.itens.map((x) => el("li", { class: "card" + (x.lida ? "" : " destaque"), style: "list-style:none" },
      el("div", { class: "head" }, el("span", { class: "name", style: "font-weight:500;font-size:15px" }, x.lida ? null : el("span", { class: "tag", text: "NOVO" }), x.texto),
        el("span", { class: "meta", text: dt(x.criada_em) })),
      x.link ? el("div", { class: "actions" }, el("a", { class: "btn link", href: x.link }, "Abrir")) : null))));
    // ao abrir a lista, os avisos passam a contar como lidos (continuam destacados nesta visita)
    if (n.nao_lidas && !A.marcando) {
      A.marcando = true;
      rpc("marcar_notificacoes_lidas").then(() => { S.notif = { ...S.notif, nao_lidas: 0 }; App.render(); })
        .catch((e) => toast(msgErro(e))).finally(() => (A.marcando = false));
    }
  }

  $("#b-avisos").addEventListener("click", () => (location.hash = "#atividades/avisos"));

  App.modulo({
    id: "atividades", nome: "Atividades",
    abas: [
      { id: "pendencias", nome: "Pendências", secao: "v-at-pendencias", contador: "c-at-pend", alerta: true },
      { id: "avisos", nome: "Avisos", secao: "v-at-avisos", contador: "c-at-avisos", alerta: true },
    ],
    async carregar(aba) {
      if (aba === "pendencias" && S.me.papel_bloqueios) A.tarefas = await rpc("listar_tarefas", { p_status: "pendente" });
    },
    render(aba) { (aba === "avisos" ? renderAvisos : renderPendencias)(); },
    contadores() { App.contador("c-at-pend", totalPendencias() || 0); App.contador("c-at-avisos", S.notif?.nao_lidas || 0); },
    totalPendencias,
  });
})();
