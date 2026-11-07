// Visual do Histórico de bloqueios da versão 008d5 (guardado na 008d6 a pedido do usuário).
// Trechos de js/bloqueios.js: tratativaCurta(), renderHist() e detalheHist(). Ver README.md.

  // versão curta para a tabela do Histórico: situação em negrito + quem e quando (a nota vai no histórico aberto)
  function tratativaCurta(b) {
    const t = b.tarefa, data = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
    if (!t) return el("div", { class: "bullet sem trat-curta" }, el("span", {}, el("b", { text: b.leve ? "Leve" : "Sem tratativa" }),
      el("span", { class: "meta", text: b.leve ? "conta para o limite" : "menos de 10 h" })));
    const tipo = t.tipo === "tratativa" ? "" : (TAREFA[t.tipo] || "") + ": ";
    if (t.status === "pendente") return el("div", { class: "bullet trat-curta " + (t.atrasada ? "atrasada" : "pendente") }, el("span", {},
      el("b", { text: tipo + (t.atrasada ? "Atrasada" : "Pendente") }),
      el("span", { class: "meta", text: `com ${t.tipo === "completar_dados" ? "o monitoramento" : t.responsavel_nome || "os moderadores"} · há ${duracao(t.criada_em).txt}` })));
    return el("div", { class: "bullet concluida trat-curta", title: t.nota || null }, el("span", {},
      el("b", { text: tipo + "Realizada" }),
      el("span", { class: "meta", text: t.importada ? "veio da planilha" : `por ${t.concluida_por_nome} · ${data(t.concluida_em)}` + (t.nota ? " · com nota" : "") })));
  }

  function renderHist() {
    const h = B.hist, t = $("#bq-t-hist");
    const cols = [["Situação"], ["Entregador"], ["Infração"], ["Punição"], ["Início"], ["Cidade"], ["Tratativa"], [""]];
    if (!h) { $("#bq-hist-total").textContent = ""; return t.replaceChildren(...tabela(cols, [], "Carregando…")); }
    preencher($("#bq-hist-cidade"), h.cidades.slice().sort().map((c) => [c, c]), "Todas as cidades");
    preencher($("#bq-hist-inf"), opcInfracoes(), "Todas as infrações");
    preencher($("#bq-hist-quem"), h.quem.slice().sort().map((n) => [n, n]), "Registrado por qualquer pessoa");
    const paginas = Math.max(1, Math.ceil(h.total / h.por));
    const ini = (h.pagina - 1) * h.por;
    $("#bq-hist-sub").textContent = (staff() ? "Todos os bloqueios e infrações leves." : "Tudo o que você registrou, com a situação atual.") + " Clique numa linha para ver o histórico de cada um.";
    $("#bq-hist-total").textContent = `${h.total} de ${h.total_geral} bloqueio(s)` + (paginas > 1 ? ` · mostrando ${ini + 1} a ${Math.min(ini + h.por, h.total)}` : "");
    $("#bq-hist-meus-box").hidden = !staff();
    // 008d: quadrinhos como os do Histórico da ativação; clicar filtra pela situação
    const c = h.contagens, sitAtual = $("#bq-hist-sit").value;
    const quadro = (k, v, sit, cls = "") => el("button", { type: "button", class: "tile clicavel " + cls + (sitAtual === sit ? " ativo" : ""), "aria-pressed": String(sitAtual === sit),
      title: sit ? "Filtrar: " + k : "Tirar o filtro de situação", onclick: () => { $("#bq-hist-sit").value = sitAtual === sit ? "" : sit; B.pagina = 1; filtrarHist(); } },
      el("div", { class: "k", text: k }), el("div", { class: "v", text: v ?? "…" }));
    $("#bq-hist-tiles").replaceChildren(...(c ? [quadro(staff() && !$("#bq-hist-meus").checked ? "Registros" : "Registrados por você", c.todos, ""),
      quadro("Bloqueados agora", c.bloqueado, "bloqueado", "hl2"), quadro("Tratativa pendente", c.tratativa_pendente, "tratativa_pendente", "hl"),
      quadro("Liberados (prazo cumprido)", c.liberado, "liberado", "good"), quadro("Liberados antes", c.liberado_antes, "liberado_antes"),
      quadro("Parceria encerrada", c.encerramento, "encerramento"), quadro("Para revisar", c.revisar, "revisar", c.revisar ? "hl" : "")] : []));
    const ir = (n) => { B.pagina = n; App.carregar(); $("#bq-t-hist").scrollIntoView({ block: "start" }); };
    $("#bq-hist-paginas").replaceChildren(...(paginas > 1 ? [
      el("button", { class: "btn small", type: "button", disabled: h.pagina === 1, onclick: () => ir(h.pagina - 1) }, "‹ Anterior"),
      el("span", { text: `Página ${h.pagina} de ${paginas}` }),
      el("button", { class: "btn small", type: "button", disabled: h.pagina === paginas, onclick: () => ir(h.pagina + 1) }, "Próxima ›")] : []));
    t.replaceChildren(...tabela(cols, h.itens.map((b) => {
      const acoes = el("td", { class: "acoes-hist" });
      if (podeCorrigir(b) && !B.confirmar[b.id]) acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => abrirCorrecao(b) }, "Corrigir"));
      acoes.append(botaoAnexos(b));
      if (mod()) {
        if (B.confirmar[b.id]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => excluir(b, e.currentTarget) }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete B.confirmar[b.id]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { B.confirmar[b.id] = true; render(); } }, "Excluir"));
      }
      const aberto = B.abertos.has(b.id);
      acoes.prepend(el("button", { class: "btn link", type: "button", "aria-expanded": String(aberto), onclick: (e) => { e.stopPropagation(); alternarHist(b.id); } }, aberto ? "Ocultar histórico" : "Ver histórico"));
      const linha = el("tr", { class: "clicavel", onclick: (e) => { if (!e.target.closest("button, a")) alternarHist(b.id); } }, el("td", {}, pillSit(b.situacao), b.revisar ? el("div", {}, alertaRevisar(b, true)) : null),
        el("td", {}, linkFicha(b), el("br"), el("span", { class: "mono meta", text: b.id_app })),
        el("td", {}, b.infracao, b.leve ? el("span", { class: "tag", style: "margin-left:6px", text: "LEVE" }) : null),
        el("td", {}, horasTxt(b.horas), b.leve ? null : el("div", { class: "meta", text: ord(b.ocorrencia) + " ocorrência" + (b.ocorrencia < b.ocorrencia_total ? ` (${ord(b.ocorrencia_total)} no total)` : "") })),
        el("td", {}, el("span", { class: "nowrap-data", text: dt(b.inicio) }), el("div", { class: "meta", text: "por " + (b.registrado_por_nome || "—") })),
        el("td", { text: b.cidade || "—" }),
        el("td", {}, tratativaCurta(b)), acoes);
      return aberto ? [linha, el("tr", { class: "detalhe-hist" }, el("td", { colspan: String(cols.length) }, detalheHist(b)))] : [linha];
    }).flat(), "Nenhum bloqueio com esse filtro."));
  }
  // histórico de cada registro (como no Histórico da ativação): eventos + dados que não cabem na linha
  async function alternarHist(id) {
    if (B.abertos.has(id)) B.abertos.delete(id); else B.abertos.add(id);
    render();
    if (B.abertos.has(id) && !B.eventos[id]) {
      try { B.eventos[id] = await rpc("eventos_do_bloqueio", { p_bloqueio: id }); } catch (e) { B.eventos[id] = { erro: msgErro(e) }; }
      render();
    }
  }
  function detalheHist(b) {
    const ev = B.eventos[b.id];
    const t = b.tarefa;
    return el("div", { class: "detalhe-bloqueio" },
      el("div", { class: "meta" }, [b.fim && b.horas != null ? `Fim do bloqueio: ${dt(b.fim)}` : null, b.observacao ? `Observação: ${b.observacao}` : null,
        b.motivo_liberacao ? `Motivo da liberação: ${b.motivo_liberacao}` : null, b.importado ? "Veio da planilha." : null].filter(Boolean).join(" · ")),
      el("div", { class: "trat-completa" }, bulletTratativa(b)),
      !ev ? el("p", { class: "meta", text: "Carregando histórico…" }) : ev.erro ? el("p", { class: "err", text: ev.erro })
        : ev.length ? el("ol", { class: "timeline" }, ev.map((x) => el("li", {}, el("b", { text: EVB[x.tipo] || x.tipo }), ` ${x.por_nome ? "por " + x.por_nome + " " : ""}em ${dt(x.em)}${x.detalhe ? " · " + x.detalhe : ""}`)))
        : el("p", { class: "meta", text: "Sem eventos registrados." }));
  }
