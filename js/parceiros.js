// Módulo "Parceiros" (009e, completo na 009f): o segundo processo de ativação. Registro direto (quem ativou
// registra), por qualquer papel: estabelecimento, cidade e observação (registrar_parceiro). Cada parceiro ativado
// conta sozinho nas tarefas "Aprovar parceiros" de quem ativou (na cidade) e nas metas pessoais, e aparece nas
// Notícias rápidas da tela inicial.
// Abas: Ativar parceiro (formulário + suas tarefas + seus últimos), Parceiros ativos (lista com busca e cidade;
// parceiro ativado continua ativo, sem desativação; no topo, quantos e a comparação com a semana anterior) e
// Ativações (antes "Por cidade": os cartões de cada cidade + o histórico de quem ativou o quê, por dia).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, janela } = App.u;
  const S = App.S;
  const P = { meus: null, lista: null, tarefas: null, cidades: null, historico: null, resumo: null, conf: {}, erro: null };

  // aviso depois de aprovar: em quais tarefas a aprovação entrou (também usado na ativação de entregadores)
  App.contouPara = function (tarefas) {
    if (!tarefas?.length) return "";
    return " Contou para: " + tarefas.map((t) => `${t.titulo} (${t.progresso} de ${t.meta}${t.progresso >= t.meta ? ", meta atingida" : ""})`).join("; ") + ".";
  };

  const form = $("#pa-form"), erro = $("#pa-erro");
  form.addEventListener("input", () => (erro.hidden = true));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const b = $("#pa-enviar"); b.disabled = true;
    try {
      const r = await rpc("registrar_parceiro", { p_estabelecimento: $("#pa-estab").value.trim(), p_cidade: $("#pa-cidade").value.trim(), p_observacao: $("#pa-obs").value.trim() || null });
      form.reset(); $("#pa-estab").focus();
      const te = r.tarefa_entregadores;
      toast(`Parceiro ativado: ${r.parceiro.estabelecimento}!${App.contouPara(r.tarefas)}` +
        (te ? (te.nova ? ` Nasceu a tarefa “${te.titulo}” para a equipe.` : ` A tarefa de entregadores da cidade subiu para ${te.meta}.`) : ""));
      await App.carregar();
    } catch (e) { erro.textContent = msgErro(e); erro.hidden = false; } finally { b.disabled = false; }
  });
  let busca = null;
  $("#pa-busca").addEventListener("input", () => { clearTimeout(busca); busca = setTimeout(() => App.carregar(), 350); });
  for (const id of ["#pa-filtro-cidade", "#pa-meus"]) $(id).addEventListener("change", () => App.carregar());

  const linha = (p) => el("li", { class: "parceiro" },
    el("div", {}, el("b", { text: p.estabelecimento }), el("span", { class: "meta", text: " · " + p.cidade }),
      p.observacao ? el("div", { class: "meta", text: p.observacao }) : null,
      el("div", { class: "meta", text: `ativado por ${p.meu ? "você" : p.criado_por_nome || "—"} em ${dt(p.criado_em)}` })),
    p.pode_excluir ? (P.conf[p.id]
      ? el("span", {}, el("button", { class: "btn danger small", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await rpc("excluir_parceiro", { p_id: p.id }); delete P.conf[p.id]; toast("Registro excluído."); await App.carregar(); } catch (err) { b.disabled = false; toast(msgErro(err)); }
        } }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete P.conf[p.id]; App.render(); } }, "Cancelar"))
      : el("button", { class: "btn quiet small", type: "button", title: "Só para registro feito por engano", onclick: () => { P.conf[p.id] = true; App.render(); } }, "Excluir")) : null);

  function renderNovo() {
    $("#pa-cidades").replaceChildren(...App.u.CIDADES.map((c) => el("option", { value: c })));
    const t = $("#pa-tarefas");
    const minhas = (P.tarefas || []);
    t.replaceChildren(el("h3", { text: "Suas tarefas de aprovar parceiros" }),
      minhas.length ? el("ul", { class: "pa-tarefas" }, minhas.map((a) => {
        const pct = a.meta ? Math.min(100, Math.round((a.progresso / a.meta) * 100)) : 0;
        return el("li", {}, el("b", { text: a.titulo }), el("div", { class: "progresso-tarefa" }, App.u.progresso(a.progresso, a.meta, `Progresso: ${a.progresso} de ${a.meta}`),
          el("span", { class: "meta", text: `${a.progresso} de ${a.meta}${a.progresso >= a.meta ? ", meta atingida" : ""}` })));
      })) : el("p", { class: "meta" }, "Nenhuma em andamento com você. ", el("a", { href: "#atividades/sugeridas" }, "Criar uma tarefa “Aprovar parceiros”"), " para você ou para alguém: cada parceiro ativado na cidade conta sozinho."),
      el("h3", { text: "Os seus últimos" }),
      !P.meus ? carregandoEl() : P.meus.length ? el("ul", { class: "parceiros-lista" }, P.meus.slice(0, 8).map(linha)) : el("p", { class: "meta", text: "Você ainda não ativou nenhum parceiro." }));
  }
  // quantos ativos e a comparação desta semana com a anterior (semana de terça a segunda, horário de Brasília,
  // a mesma do Resumo semanal)
  const diaBr = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  const somaDias = (iso, n) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  function semanas() {
    const hoje = diaBr(Date.now());
    const isodow = new Date(hoje + "T12:00:00Z").getUTCDay() || 7;          // segunda = 1 ... domingo = 7
    const ini = somaDias(hoje, -((isodow + 5) % 7));                         // terça desta semana
    return { ini, iniAnt: somaDias(ini, -7) };
  }
  function resumoSemana(itens, cidade) {
    const { ini, iniAnt } = semanas();
    const dias = itens.map((p) => diaBr(p.criado_em));
    return { cidade, ini, total: itens.length, este: dias.filter((d) => d >= ini).length, anterior: dias.filter((d) => d >= iniAnt && d < ini).length };
  }
  // análise da semana (tela Ativações): esta semana × a anterior, com a variação
  function blocoSemana(r) {
    const dif = r.este - r.anterior;
    const pct = r.anterior ? Math.round((dif / r.anterior) * 100) : null;
    const comp = dif > 0 ? `${dif} a mais que na semana passada${pct != null ? ` (+${pct}%)` : ""}` : dif < 0 ? `${-dif} a menos que na semana passada (${pct}%)` : "igual à semana passada";
    return el("div", { class: "pa-resumo", id: "pa-resumo" },
      el("div", { class: "tiles" },
        el("div", { class: "tile good" }, el("div", { class: "v", text: r.este }), el("div", { class: "k", text: `ativados nesta semana (desde terça, ${r.ini.slice(8, 10)}/${r.ini.slice(5, 7)})` })),
        el("div", { class: "tile" }, el("div", { class: "v", text: r.anterior }), el("div", { class: "k", text: "na semana passada" })),
        el("div", { class: "tile" }, el("div", { class: "v", text: r.total }), el("div", { class: "k", text: "parceiros ativos no total" }))),
      el("p", { class: dif > 0 ? "sobe" : dif < 0 ? "desce" : "meta", text: `${r.cidade ? r.cidade + ": " : ""}${r.este} ativado${r.este === 1 ? "" : "s"} nesta semana, ${comp}.` }));
  }
  function renderLista() {
    const box = $("#pa-lista");
    if (P.erro) return box.replaceChildren(el("p", { class: "warn-msg", text: P.erro }));
    const d = P.lista;
    if (!d) return box.replaceChildren(carregandoEl());
    const sel = $("#pa-filtro-cidade"), atual = sel.value;
    sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...d.por_cidade.map((c) => el("option", { value: c.cidade, text: `${c.cidade} (${c.n})` })));
    if (atual && !d.por_cidade.some((c) => c.cidade === atual)) sel.append(el("option", { value: atual, text: atual }));
    sel.value = atual;
    box.replaceChildren(el("p", { class: "meta", text: `${d.total} ${d.total === 1 ? "parceiro ativo" : "parceiros ativos"} · você ativou ${d.meus_30d} nos últimos 30 dias` }),
      d.itens.length ? el("ul", { class: "parceiros-lista" }, d.itens.map(linha)) : vazio("Nenhum parceiro aqui", "Use “Ativar parceiro” para registrar um."));
    renderCidades();   // 009z13b: a antiga aba Ativações agora fica no topo desta
  }
  // histórico das ativações: quem ativou qual parceiro, onde e quando, agrupado por dia
  function renderHistorico() {
    const box = $("#pa-historico");
    const sel = $("#pa-filtro-cidade");   // 009z13b: o mesmo filtro de cidade da lista
    if (!P.historico) { $("#pa-semana").replaceChildren(el("div", { class: "pa-semana-reserva", "aria-hidden": "true" })); return box.replaceChildren(carregandoEl()); }
    const lista = P.historico.filter((p) => !sel.value || p.cidade === sel.value);
    $("#pa-semana").replaceChildren(blocoSemana(resumoSemana(lista, sel.value || null)));
    if (!lista.length) return box.replaceChildren(el("p", { class: "meta", text: "Nenhuma ativação ainda." }));
    const dias = new Map();
    for (const p of lista.slice(0, 300)) {
      const d = new Date(p.criado_em).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
      if (!dias.has(d)) dias.set(d, []);
      dias.get(d).push(p);
    }
    box.replaceChildren(...[...dias].map(([d, l]) => el("div", { class: "pa-hist-dia" },
      el("h4", {}, d.charAt(0).toUpperCase() + d.slice(1), el("span", { class: "count", text: l.length })),
      el("ul", { class: "pa-hist" }, l.map((p) => el("li", {},
        el("span", { class: "meta mono", text: new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) }),
        el("span", { class: "pa-hist-frase" }, el("b", { text: p.meu ? "Você" : p.criado_por_nome || "Alguém" }), " ativou ", el("b", { text: p.estabelecimento }), ` em ${p.cidade}!`,
          p.observacao ? el("span", { class: "meta", text: ` · ${p.observacao}` }) : null)))))));
  }
  function renderCidades() {
    renderHistorico();
    const box = $("#pa-por-cidade");
    if (P.erro) return box.replaceChildren(el("p", { class: "warn-msg", text: P.erro }));
    if (!P.cidades) return box.replaceChildren(carregandoEl());
    if (!P.cidades.length) return box.replaceChildren(vazio("Nenhum parceiro ainda", "Quando alguém ativar um parceiro, a cidade aparece aqui."));
    const { ini, iniAnt } = semanas();
    const semanaDe = (cidade) => { const d = (P.historico || []).filter((p) => p.cidade === cidade).map((p) => diaBr(p.criado_em)); return [d.filter((x) => x >= ini).length, d.filter((x) => x >= iniAnt && x < ini).length]; };
    const ver = (cidade) => { const f = $("#pa-filtro-cidade"); if (![...f.options].some((o) => o.value === cidade)) f.append(el("option", { value: cidade, text: cidade })); f.value = cidade; App.carregar(); App.u.rolar?.($("#pa-busca")); };
    box.replaceChildren(el("div", { class: "pa-cidades" }, P.cidades.map((c) => el("article", { class: "panel pa-cidade" },
      el("div", { class: "inicio-topo" }, el("h3", { style: "margin:0", text: c.cidade }),
        el("button", { class: "btn small", type: "button", onclick: () => ver(c.cidade) }, "Ver parceiros")),
      el("div", { class: "tiles" },
        el("div", { class: "tile good" }, el("div", { class: "v", text: c.ativos }), el("div", { class: "k", text: "ativos" })),
        el("div", { class: "tile" }, el("div", { class: "v", text: semanaDe(c.cidade)[0] }), el("div", { class: "k", text: `nesta semana (passada: ${semanaDe(c.cidade)[1]})` })),
        el("div", { class: "tile" }, el("div", { class: "v", text: c.ultimos_30d }), el("div", { class: "k", text: "nos últimos 30 dias" }))),
      c.ultimo ? el("p", { class: "meta", text: `Último: ${c.ultimo.estabelecimento}, por ${c.ultimo.quem || "—"} em ${dt(c.ultimo.quando)}` }) : null,
      c.quem_mais ? el("p", { class: "meta", text: `Quem mais ativou aqui: ${c.quem_mais.nome || "—"} (${c.quem_mais.n})` }) : null))));
  }

  // ---------- Sem chamar (009z13, pedido do usuário) ----------
  // Dos arquivos do Tableau (resumo por dia e loja): quem parou de chamar (3+ dias sem pedido, chamava 1 ou mais por
  // dia), quem está chamando menos (última semana abaixo da metade da média das 4 anteriores) e os parceiros ativados
  // que ainda não chamaram. Os dias contam até o último dia enviado de cada cidade (parceiros_sem_chamar).
  const diaTxt = (d) => (d ? App.u.dia(d) : "—");
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  function tarefaContato(loja, cidade, motivo) {
    const mot = el("input", { maxlength: 300, value: motivo });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = janela("Criar tarefa de contato",
      el("p", { style: "margin:0", text: `${loja} · ${cidade}` }),
      el("label", {}, "Motivo", mot),
      el("p", { class: "meta", text: "A tarefa \u201cFazer contato\u201d fica aberta para a equipe em Atividades → Tarefas." }), erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          const bt = e.currentTarget; bt.disabled = true;
          try {
            await rpc("criar_tarefa", { p_tipo: "fazer_contato", p_campos: { contato: loja, cidade, motivo: mot.value.trim() || motivo }, p_para: [] });
            d.close(); toast("Tarefa de contato criada para a equipe.");
          } catch (err) { bt.disabled = false; erro.textContent = msgErro(err); erro.hidden = false; }
        } }, "Criar tarefa"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  function registrarAcordo(loja, cidade) {
    location.hash = "#financeiro/acordos";
    let n = 0;
    const tentar = () => {   // a tela de Acordos é montada depois da troca de endereço
      const e = $("#fi-ac-estab"), c = $("#fi-ac-cidade");
      if (e && c && e.offsetParent) { e.value = loja; c.value = cidade; $("#fi-ac-texto")?.focus(); return; }
      if (++n < 30) setTimeout(tentar, 100);
    };
    setTimeout(tentar, 100);
  }
  // ---------- Monitoramento → Parceiros (009z18, desenho "Monitoramento: proposta das 4 abas") ----------
  // Quatro grupos (monitor_parceiros): parou de chamar, chamando menos, voltou a chamar e chamando mais, cada loja com
  // as barras das 8 semanas; e os ativados que ainda não chamaram.
  const GRUPOS = [
    { id: "parou", rotulo: "Parou de chamar", sub: "3 dias ou mais sem pedido", cor: "bad", ruim: true,
      explica: "Média de 1 pedido ou mais por dia e nenhum pedido nos últimos 3 dias." },
    { id: "menos", rotulo: "Chamando menos", sub: "última semana abaixo da metade", cor: "warn", ruim: true,
      explica: "Última semana abaixo da metade da média semanal das 4 anteriores." },
    { id: "voltou", rotulo: "Voltou a chamar", sub: "voltou depois de 7 dias ou mais parado", cor: "ok",
      explica: "Ficou 7 dias ou mais sem pedido e voltou a chamar nesta semana." },
    { id: "mais", rotulo: "Chamando mais", sub: "última semana acima de 1,5 vez a média", cor: "ok",
      explica: "Última semana acima de 1,5 vez a média das 4 semanas anteriores." },
  ];
  P.grupo = "parou";
  const num1 = (v) => String(v ?? "—").replace(".", ",");
  function barrasSemanas(x, cor) {
    const max = Math.max(1, ...x.semanas);
    return el("div", { class: "mon-barras-box" },
      el("div", { class: "mon-barras", role: "img", "aria-label": "Pedidos nas últimas 8 semanas: " + x.semanas.join(", ") },
        x.semanas.map((v, i) => el("span", { class: "mon-barra" + (i === 7 ? " ultima " + cor : ""), style: `height:${Math.max(2, Math.round((v / max) * 36))}px` }))),
      el("span", { class: "meta mon-barras-leg", text: "8 semanas" }));
  }
  function linhaParceiro(x, g) {
    const ultimoTxt = x.dias === 0 ? "hoje" : x.dias === 1 ? "ontem" : `há ${x.dias} dias`;
    const varTxt = g.id === "voltou" ? `voltou depois de ${plural(x.parado_dias, "dia", "dias")} parado` : x.variacao != null ? `${x.variacao > 0 ? "+" : "−"}${Math.abs(x.variacao)}%` : "";
    const motivo = g.id === "parou" ? `Parou de chamar: último pedido em ${diaTxt(x.ultimo)}` : `Chamando menos: ${x.semana} pedidos na última semana, antes ${num1(x.media_semana)} por semana`;
    return el("li", { class: "mon-parceiro" },
      el("div", { class: "mon-parceiro-nome" },
        el("b", { text: x.loja }), x.parceiro ? el("span", { class: "tag", text: "Parceiro ativado" }) : null,
        el("span", { class: "meta", text: `${x.cidade} · último pedido ${ultimoTxt}` })),
      barrasSemanas(x, g.cor),
      el("div", { class: "mon-parceiro-num" },
        el("span", { class: "meta", text: `Média: ${num1(x.media_semana ?? "—")} por semana` }),
        el("b", { class: "mon-cor-" + g.cor, text: `Última: ${x.semana}${varTxt ? " · " + varTxt : ""}` })),
      el("div", { class: "actions" }, g.ruim ? [
        el("button", { class: "btn small primary", type: "button", onclick: () => tarefaContato(x.loja, x.cidade, motivo) }, "Criar tarefa de contato"),
        el("button", { class: "btn small", type: "button", onclick: () => registrarAcordo(x.loja, x.cidade) }, "Registrar acordo")] : [
        el("button", { class: "btn small", type: "button", onclick: () => App.mensagens?.abrir("parceiro_agradecimento", { estabelecimento: x.loja }) }, "Mensagem de agradecimento"),
        el("button", { class: "btn small", type: "button", onclick: () => { location.hash = "#financeiro/acordos"; } }, "Ver acordos")]));
  }
  function renderSemChamar() {
    const box = $("#pa-sem-lista"), d = P.sem;
    if (P.erro && !d) return box.replaceChildren(el("p", { class: "err", text: P.erro }));
    if (!d) return box.replaceChildren(carregandoEl());
    const sel = $("#pa-sem-cidade"), atual = sel.value;
    sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...d.cidades.map((c) => el("option", { value: c.cidade, text: c.cidade })));
    sel.value = d.cidades.some((c) => c.cidade === atual) ? atual : "";
    sel.hidden = d.cidades.length <= 1 && !sel.value;
    if (!d.cidades.length) {
      $("#pa-sem-grupos").replaceChildren(); $("#pa-sem-pedido-box").hidden = true;
      return box.replaceChildren(vazio("Ainda não há pedidos do Tableau", "A lista sai dos arquivos que um moderador envia em Monitoramento → Enviar dados."));
    }
    const f = (l) => (l || []).filter((x) => !sel.value || x.cidade === sel.value);
    $("#pa-sem-grupos").replaceChildren(...GRUPOS.map((g) => el("button", { type: "button", class: "mon-grupo", "aria-pressed": String(P.grupo === g.id),
      onclick: () => { P.grupo = g.id; renderSemChamar(); } },
      el("span", { class: "mon-grupo-rot" }, el("span", { class: "mon-ponto " + g.cor, "aria-hidden": "true" }), g.rotulo),
      el("span", { class: "mon-grupo-n", text: f(d[g.id]).length }),
      el("span", { class: "meta", text: g.sub }))));
    const g = GRUPOS.find((x) => x.id === P.grupo), itens = f(d[g.id]);
    const ref = d.cidades.filter((c) => !sel.value || c.cidade === sel.value).map((c) => `${c.cidade} até ${diaTxt(c.ate)}`);
    box.replaceChildren(el("section", { class: "panel mon-lista-parceiros" },
      el("div", { class: "mon-lista-cab" }, el("h3", { text: g.rotulo }), el("span", { class: "meta", text: g.explica })),
      itens.length ? el("ul", {}, itens.map((x) => linhaParceiro(x, g))) : el("p", { class: "meta", text: "Nenhuma loja neste grupo." }),
      el("p", { class: "meta", text: ref.length > 3 ? `Dados do Tableau de ${plural(ref.length, "cidade", "cidades")}.` : `Dados do Tableau: ${ref.join(" · ")}.` })));
    const sem = f(d.sem_pedido);
    $("#pa-sem-pedido-box").hidden = !sem.length;
    $("#pa-sem-pedido-tit").textContent = `Ativados que ainda não chamaram (${sem.length})`;
    $("#pa-sem-pedido").replaceChildren(el("ul", { class: "mon-sem-pedido-lista" }, sem.map((x) => el("li", {},
      el("span", {}, el("b", { text: x.estabelecimento }), ` · ${x.cidade} · ativado há ${plural(x.dias, "dia", "dias")}${x.por ? ", por " + x.por : ""}`),
      el("button", { class: "btn link", type: "button", onclick: () => tarefaContato(x.estabelecimento, x.cidade, "Ativado e ainda sem o primeiro pedido") }, "Criar tarefa de contato")))));
  }
  $("#pa-sem-cidade")?.addEventListener("change", () => renderSemChamar());
  App.semChamar = { carregar: async () => { P.sem = await rpc("monitor_parceiros", {}); }, render: renderSemChamar };
  App.registrarAcordo = registrarAcordo; App.tarefaContato = tarefaContato;

  App.modulo({
    id: "parceiros", nome: "Parceiros",
    abas: [
      { id: "novo", nome: "Ativar parceiro", secao: "v-pa-novo" },
      { id: "lista", nome: "Parceiros ativos", secao: "v-pa-lista" },
    ],
    padrao: () => "novo",
    async carregar(aba) {
      try {
        if (aba === "lista") {
          // 009z13b: a lista + o que era a aba Ativações (resumo da semana, cidades e histórico; estes a cada 5 min)
          const velho = !P.cidadesEm || Date.now() - P.cidadesEm > 300000;
          const [l, c, todos] = await Promise.all([rpc("listar_parceiros", { p_busca: $("#pa-busca").value.trim() || null, p_cidade: $("#pa-filtro-cidade").value || null, p_meus: $("#pa-meus").checked }),
            velho ? rpc("parceiros_por_cidade") : P.cidades, velho ? rpc("listar_parceiros", { p_limite: 2000 }).then((x) => x.itens) : P.historico]);
          P.lista = l; P.cidades = c; P.historico = todos; if (velho) P.cidadesEm = Date.now();
        }
        else {
          const [l, t] = await Promise.all([rpc("listar_parceiros", { p_meus: true, p_limite: 8 }), (App.listarAtividades ? App.listarAtividades(0) : rpc("listar_atividades"))]);
          P.meus = l.itens;
          P.tarefas = t.filter((a) => a.tipo === "ativar_parceiro" && a.status === "aceita" && a.sou_participante && a.modo === "solicitacao");
        }
        P.erro = null;
      } catch (e) { P.erro = msgErro(e); throw e; }
    },
    render: (aba) => (aba === "lista" ? renderLista() : renderNovo()),
  });

  // ---------- Notícias rápidas (tela inicial) ----------
  // texto comemorativo escolhido pelo id (o mesmo parceiro sempre com a mesma frase)
  const FRASES = [
    (q, e, c) => `${q} ativou ${e} em ${c}. Mais um parceiro com a gente.`,
    (q, e, c) => `Parceiro novo: ${e} (${c}), ativado por ${q}.`,
    (q, e, c) => `${q} trouxe ${e} para a rede em ${c}.`,
    (q, e, c) => `${e} agora é parceiro em ${c}. Ativação de ${q}.`,
    (q, e, c) => `${c} ganhou mais um parceiro: ${e}, por ${q}.`,
  ];
  const primeiro = (n) => String(n || "Alguém").split(" ")[0];
  const ha = (q) => App.u.duracao(q).txt === "0 min" ? "agora" : "há " + App.u.duracao(q).txt;
  // 009x6 (pedido do usuário): Notícias rápidas = tarefas concluídas nos últimos 7 dias
  App.noticias = {
    async carregar() {
      [S.noticias, S.parceirosSemana] = await Promise.all([rpc("noticias_rapidas", { p_limite: 6 }), rpc("parceiros_semana").catch(() => null)]);
    },
    render() {
      const box = $("#inicio-noticias");
      if (box) {
        const l = S.noticias || [];
        box.hidden = !l.length;
        box.replaceChildren(...(l.length ? [el("h2", { class: "rapidos-titulo", icone: "noticias" }, "Notícias rápidas"),
          el("ul", { class: "noticias" }, l.map((n) => el("li", { class: "noticia" },
            el("span", { class: "noticia-texto", text: n.tipo === "acordo" ? `Acordo novo com ${n.titulo}${n.cidade ? " (" + n.cidade + ")" : ""}, registrado por ${n.eu ? "você" : primeiro(n.quem)}.`
              : n.equipe ? `A equipe bateu a meta: ${n.titulo}.` : `${n.eu ? "Você" : primeiro(n.quem)} concluiu: ${n.titulo}.` }),
            el("span", { class: "meta", text: ha(n.quando) }))))] : []));
      }
      // 009x6: os parceiros ganharam um bloco só deles: a semana (com o + ou − da passada) e os 10 últimos
      const bp = $("#inicio-parceiros"), p = S.parceirosSemana;
      if (!bp) return;
      bp.hidden = !p?.ultimos?.length;
      if (bp.hidden) return bp.replaceChildren();
      const dif = p.esta_semana - p.semana_passada;
      bp.replaceChildren(el("h2", { class: "rapidos-titulo", icone: "parceiro" },
          `Parceiros ativados na semana: ${p.esta_semana}`,
          el("span", { class: "meta parceiros-dif", text: dif === 0 ? " (igual à semana passada)" : ` (${dif > 0 ? "+" : "−"}${Math.abs(dif)} em relação à semana passada, que teve ${p.semana_passada})` })),
        el("ul", { class: "noticias" }, p.ultimos.map((n) => el("li", { class: "noticia" },
          el("span", { class: "noticia-texto", text: FRASES[n.id % FRASES.length](n.eu ? "Você" : primeiro(n.quem), n.estabelecimento, n.cidade) }),
          el("span", { class: "meta", text: ha(n.quando) })))));
    },
  };
})();
