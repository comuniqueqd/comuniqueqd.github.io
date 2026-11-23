// Módulo "Análises": números agregados para todos os papéis (supabase/005-analises-anexos.sql).
// 008c: Análises simples (os números do dia a dia, analises_simples) e Análises complexas (para entender
// o que funciona, analises_complexas), com o mesmo período e cidade. Aba Resumo semanal: terça a segunda,
// com comparação entre semanas e download em CSV ou PDF.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, vazio, carregandoEl, rpc, msgErro, tabela, barras, baixarCSV, grafico, horas, PAPEL } = App.u;
  const S = App.S;
  const A = { periodo: 30, cidade: "", dados: null, chave: "", cidades: null, erro: null,
              resumo: {}, semana: "", comparar: "anterior", semanas: null };
  const render = () => App.render();
  const n = (v) => (v == null ? "—" : String(v).replace(".", ","));
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const card = (titulo, nota, ...conteudo) => el("div", { class: "panel" }, el("h3", { text: titulo }), nota ? el("p", { class: "an-nota", text: nota }) : null, ...conteudo);
  const destaque = (v, rotulo) => el("div", {}, el("b", { text: n(v) }), el("span", { text: rotulo }));

  // ---------- análises (008c: simples e complexas) ----------
  // as duas abas dividem o período e a cidade; cada uma guarda os próprios dados
  // 008c: os antigos Painéis da ativação e dos bloqueios viraram cartões daqui (metricas e metricas_bloqueios)
  const D = { simples: null, complexas: null, chave: {}, erro: {}, mAtiv: null, mBloq: null };
  const chaveAnalises = () => `${A.periodo}|${A.cidade}`;
  async function carregarAnalises(tipo) {
    if (!A.cidades) A.cidades = await rpc("listar_cidades").catch(() => []);
    const chave = chaveAnalises();
    // 009x (AT6): as análises pesam no banco; com o mesmo período e cidade, só recalcula depois de 5 min
    if (D.chave[tipo] === chave && D[tipo] && Date.now() - (D.em?.[tipo] || 0) < 300000) return;
    try {
      const dias = A.periodo === "tudo" ? null : A.periodo;
      const [d, ma, mb] = await Promise.all([
        rpc(tipo === "simples" ? "analises_simples" : "analises_complexas", { p_dias: dias, p_cidade: A.cidade || null }),
        rpc("metricas", {}),
        S.me.papel_bloqueios ? rpc("metricas_bloqueios", { p_dias: dias, p_cidade: A.cidade || null }) : null]);
      if (chave === chaveAnalises()) { D[tipo] = d; D.mAtiv = ma; D.mBloq = mb; D.chave[tipo] = chave; D.erro[tipo] = null; (D.em ||= {})[tipo] = Date.now(); }
    } catch (e) { D.erro[tipo] = msgErro(e); }
  }
  // 009x: os números ficam guardados por até 5 min (AT6); a tela diz de quando são e deixa atualizar na hora
  function marcarAtualizado(tipo) {
    const em = D.em?.[tipo];
    document.querySelectorAll("[data-an-atualizado]").forEach((x) => x.replaceChildren(...(em ? [
      `Números de ${new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: App.u.FUSO })} `,
      el("button", { class: "btn link small", type: "button", onclick: (e) => { e.currentTarget.disabled = true; D.em[tipo] = 0; App.carregar(); } }, "Atualizar")] : [])));
  }
  const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const DIAS_LONGOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  function mapaCalor(lista, cor = "var(--accent)") {
    const max = Math.max(1, ...lista.map((x) => x.qtd));
    const mapa = new Map(lista.map((x) => [`${x.dia}-${x.hora}`, x.qtd]));
    const cel = [el("span")];
    for (let h = 0; h < 24; h++) cel.push(el("span", { class: "h", text: h % 3 === 0 ? String(h) : "" }));
    for (let d = 0; d < 7; d++) {
      cel.push(el("span", { text: DIAS[d] }));
      for (let h = 0; h < 24; h++) {
        const q = mapa.get(`${d}-${h}`) || 0;
        cel.push(el("span", { class: "c", title: `${DIAS[d]}, ${h}h: ${q} registro(s)`,
          style: q ? `background:color-mix(in srgb, ${cor} ${Math.round(15 + (85 * q) / max)}%, transparent)` : null }));
      }
    }
    return el("div", { class: "calor", role: "img", "aria-label": "Registros por dia da semana e hora" }, cel);
  }
  App.mapaCalor = mapaCalor;  // também usado no Painel das tarefas (js/painel.js)
  // o que mais aparece no mapa: dia, hora e faixa do dia
  function picos(lista) {
    if (!lista.length) return null;
    const total = lista.reduce((s, x) => s + x.qtd, 0);
    const porDia = Array(7).fill(0), porHora = Array(24).fill(0);
    for (const x of lista) { porDia[x.dia] += x.qtd; porHora[x.hora] += x.qtd; }
    const dia = porDia.indexOf(Math.max(...porDia)), hora = porHora.indexOf(Math.max(...porHora));
    const faixas = [["madrugada (0–6h)", 0, 6], ["manhã (6–12h)", 6, 12], ["tarde (12–18h)", 12, 18], ["noite (18–24h)", 18, 24]]
      .map(([nome, a, b]) => [nome, porHora.slice(a, b).reduce((s, v) => s + v, 0)]);
    const faixa = faixas.reduce((m, f) => (f[1] > m[1] ? f : m));
    return { total, dia: DIAS_LONGOS[dia], hora, faixa: faixa[0], faixaPct: Math.round((100 * faixa[1]) / total) };
  }
  const largo = (painel) => (painel.classList.add("largo"), painel);
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

  function prepararFiltros() {
    document.querySelectorAll("[data-an-periodo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.anPeriodo === String(A.periodo))));
    document.querySelectorAll("select.an-cidade").forEach((sel) => {
      if (A.cidades && sel.dataset.sig !== String(A.cidades.length)) {
        sel.dataset.sig = String(A.cidades.length);
        sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...A.cidades.map((c) => el("option", { value: c, text: c })));
      }
      sel.value = A.cidade;
    });
  }
  const textoPeriodo = () => (A.periodo === "tudo" ? "desde o início" : `nos últimos ${A.periodo} dias`) + (A.cidade ? " em " + A.cidade : "");

  // ---------- análises simples: os números do dia a dia ----------
  function renderSimples() {
    prepararFiltros();
    const box = $("#as-cards"), d = D.simples;
    if (D.erro.simples && !d) return box.replaceChildren(el("p", { class: "err", text: D.erro.simples }));
    if (!d || D.chave.simples !== chaveAnalises()) return box.replaceChildren(carregandoEl());
    marcarAtualizado("simples");
    $("#as-sub").textContent = `Os números do dia a dia ${textoPeriodo()}. “Agora” é o momento atual; o resto vale para o período escolhido.`;
    const at = d.ativacao, mot = d.motivos_nao_aprovacao, ag = d.agora, ri = d.reincidencia, lv = d.leves, tr = d.tratativas, av = d.atividades, vc = d.voce;
    const pMeu = picos(d.dia_hora_meu), pEq = picos(d.dia_hora);
    const totalNao = mot.reduce((s, x) => s + x.qtd, 0);
    const cards = [
      card("Ativação de entregadores", "Agora: o que espera análise ou novo contato. No período: o que entrou e como terminou.",
        el("div", { class: "destaques" }, destaque(at.aguardando_analise, "aguardando análise agora"), destaque(at.aguardando_contato, "aguardando novo contato")),
        el("div", { class: "destaques" }, destaque(at.enviados, "enviados no período"), destaque(at.aprovados, "aprovados"),
          destaque(at.enviados ? n(pct(at.aprovados, at.enviados)) + "%" : null, "taxa de aprovação"),
          destaque(at.em_aberto, "ainda em aberto"), destaque(at.encerrados, "encerrados"),
          destaque(at.horas_ate_aprovar, "horas do envio à aprovação (mediana)")),
        D.mAtiv ? el("div", { class: "destaques" }, destaque(D.mAtiv.resumo.aprovados_hoje, "aprovados hoje"), destaque(D.mAtiv.resumo.aprovados_7d, "aprovados em 7 dias"),
          destaque(D.mAtiv.resumo.aprovacao_1a_analise == null ? null : D.mAtiv.resumo.aprovacao_1a_analise + "%", "aprovados na 1ª análise")) : null),
      D.mAtiv ? card("Ativação nos últimos 14 dias", "Enviados (pontos) e decisões por dia (barras): aprovados, reprovados e encerrados.",
        el("div", { class: "legend" }, el("span", {}, el("i", { style: "background:var(--ok)" }), "Aprovados"), el("span", {}, el("i", { style: "background:var(--bad)" }), "Reprovados"),
          el("span", {}, el("i", { style: "background:var(--gray)" }), "Encerrados"), el("span", {}, el("i", { style: "background:var(--accent);border-radius:50%" }), "Enviados")),
        grafico(D.mAtiv.por_dia, [["aprovados", "var(--ok)", "aprovado(s)"], ["reprovados", "var(--bad)", "reprovado(s)"], ["encerrados", "var(--gray)", "encerrado(s)"]],
          ["enviados", "var(--accent)", "enviado(s)"], "Enviados, aprovados, reprovados e encerrados por dia nos últimos 14 dias")) : null,
      card("Por que não aprovou", "Reprovações e encerramentos do período, pelo motivo escolhido na decisão (as decisões desfeitas não contam).",
        el("div", { class: "destaques" }, destaque(totalNao, "não aprovações"),
          destaque(mot.filter((x) => x.tipo === "reprovado").reduce((s, x) => s + x.qtd, 0), "reprovações"),
          destaque(mot.filter((x) => x.tipo === "encerrado").reduce((s, x) => s + x.qtd, 0), "encerramentos")),
        ...barras(mot.map((x) => ({ rotulo: `${x.motivo} (${x.tipo === "encerrado" ? "encerramento" : "reprovação"})`, qtd: x.qtd,
          extra: `${x.qtd} · ${n(pct(x.qtd, totalNao))}%` })), "var(--bad)", "Nenhuma reprovação ou encerramento no período.")),
    ];
    if (d.tem_bloqueios) {
      cards.push(
        card("Restrições agora", "Quem está com restrição neste momento e quem sai hoje (o fim do prazo libera sozinho).",
          el("div", { class: "destaques" }, destaque(ag.bloqueados, "com restrição agora"), destaque(ag.saem_hoje, "saem da restrição hoje"),
            destaque(ag.sairam_hoje, "já saíram hoje"), destaque(ag.liberados_antes_hoje, "liberados antes do prazo hoje")),
          el("div", { class: "destaques" }, destaque(ag.tratativas_pendentes, "tratativas pendentes"),
            el("div", { class: ag.tratativas_atrasadas ? "alerta" : null }, el("b", { text: n(ag.tratativas_atrasadas) }), el("span", { text: "atrasadas" })),
            destaque(ag.encerramentos_pendentes, "encerramentos a tratar")),
          ag.saem_hoje ? el("p", { class: "an-nota", text: `O próximo a sair é às ${hhmm(ag.proximo_fim)}.` }) : null,
          ag.saem_hoje ? el("div", {}, el("h4", { class: "an-sub", text: "Saem hoje, por hora" }),
            ...barras(ag.saem_hoje_por_hora.map((x) => ({ rotulo: `${String(x.hora).padStart(2, "0")}h`, qtd: x.qtd })), "var(--ok)", "")) : null),
        card("Com restrição agora, por cidade", "Onde estão os entregadores com restrição neste momento e quantos saem hoje.",
          d.bloqueados_por_cidade.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Cidade"], ["Com restrição", 1], ["Saem hoje", 1]],
            d.bloqueados_por_cidade.map((x) => el("tr", {}, el("td", { text: x.cidade }), el("td", { class: "num", text: x.agora }), el("td", { class: "num", text: x.saem_hoje }))), "")))
            : el("p", { class: "meta", text: "Ninguém com restrição agora." })),
        D.mBloq ? card("Restrições por dia", `Restrições e infrações leves ${textoPeriodo()}, separando 1ª ocorrência, reincidência e encerramento.`,
          el("div", { class: "legend" }, el("span", {}, el("i", { style: "background:var(--accent)" }), "1ª ocorrência"), el("span", {}, el("i", { style: "background:var(--warn)" }), "Reincidência"),
            el("span", {}, el("i", { style: "background:var(--bad)" }), "Encerramento"), el("span", {}, el("i", { style: "background:var(--gray)" }), "Infração leve")),
          grafico(D.mBloq.por_dia.map((x) => ({ ...x, primeira: x.total - x.leves - x.reincidencias - x.encerramentos })),
            [["primeira", "var(--accent)", "1ª ocorrência"], ["reincidencias", "var(--warn)", "reincidência(s)"], ["encerramentos", "var(--bad)", "encerramento(s)"], ["leves", "var(--gray)", "infração(ões) leve(s)"]],
            null, "Restrições por dia")) : null);
    }
    cards.push(
      largo(card("Quando você registra", "Suas restrições, infrações leves e cadastros enviados, por dia da semana e hora. Mais escuro = mais registros seus.",
        pMeu ? el("p", { class: "pico" }, "Seu pico: ", el("b", { text: `${pMeu.dia}, por volta das ${pMeu.hora}h` }), ` · ${pMeu.faixaPct}% dos seus registros são de ${pMeu.faixa} · ${pMeu.total} registro(s) no período`) : null,
        pMeu ? mapaCalor(d.dia_hora_meu, "var(--ok)") : el("p", { class: "meta", text: "Você ainda não registrou nada no período." }))),
      largo(card("Quando a equipe registra", "Restrições, infrações leves e cadastros de toda a equipe, por dia da semana e hora (sem os importados da planilha).",
        pEq ? el("p", { class: "pico" }, "Pico da equipe: ", el("b", { text: `${pEq.dia}, por volta das ${pEq.hora}h` }), ` · ${pEq.faixaPct}% dos registros são de ${pEq.faixa}`) : null,
        pEq ? mapaCalor(d.dia_hora) : el("p", { class: "meta", text: "Nenhum registro no período." }))),
      card("Você no período", "O que você fez no período escolhido (só você vê os seus números).",
        el("div", { class: "destaques" }, destaque(vc.cadastros, "cadastros enviados"), destaque(vc.decisoes, "decisões na ativação"),
          d.tem_bloqueios ? destaque(vc.bloqueios, "restrições") : null, d.tem_bloqueios ? destaque(vc.leves, "infrações leves") : null,
          d.tem_bloqueios ? destaque(vc.tratativas, "tratativas resolvidas") : null, destaque(vc.atividades, "atividades concluídas"),
          d.tem_bloqueios ? destaque(vc.comentarios, "comentários nas fichas") : null)),
      card("Atividades", "Atividades sugeridas entre a equipe.",
        el("div", { class: "destaques" }, destaque(av.abertas_agora, "abertas agora"), destaque(av.em_andamento, "em andamento"),
          destaque(av.sugeridas, "sugeridas no período"), destaque(av.concluidas, "concluídas no período"))));
    if (d.tem_bloqueios) {
      cards.push(
        card("Tempo até reincidir", "Intervalo entre uma restrição e a seguinte do mesmo entregador.",
          el("div", { class: "destaques" }, destaque(ri.total, "reincidências no período"), destaque(ri.mediana_dias, "dias (mediana)")),
          ...barras(ri.faixas.map((f) => ({ rotulo: f.faixa, qtd: f.qtd })), "var(--warn)", "Nenhuma reincidência no período.")),
        card("Conversão das infrações leves", "Quantos entregadores com infração leve chegaram ao limite e ganharam uma restrição normal.",
          el("div", { class: "destaques" }, destaque(lv.total, "infrações leves"), destaque(lv.entregadores, "entregadores"),
            destaque(lv.atingiram_limite, "chegaram ao limite"), destaque(lv.entregadores ? n(pct(lv.atingiram_limite, lv.entregadores)) + "%" : null, "conversão"))),
        card("Infrações mais registradas", "As restrições do período por infração (as 8 primeiras).",
          ...barras(d.por_infracao.map((x) => ({ rotulo: x.infracao, qtd: x.qtd, extra: x.encerramentos ? `${x.qtd} · ${x.encerramentos} encerramento(s)` : null })), "var(--accent)", "Nenhuma restrição no período.")),
        card("Tratativas no prazo", `Tratativas criadas no período (sem as da planilha). O prazo é de ${n(tr.prazo_horas)} h.`,
          el("div", { class: "destaques" }, destaque(tr.criadas, "criadas"), destaque(tr.concluidas, "resolvidas"),
            destaque(tr.concluidas ? n(pct(tr.no_prazo, tr.concluidas)) + "%" : null, "resolvidas no prazo"),
            D.mBloq ? destaque(horas(D.mBloq.resumo.horas_ate_tratativa), "do registro à tratativa (média)") : null,
            D.mBloq?.resumo.dados_pendentes ? destaque(D.mBloq.resumo.dados_pendentes, "IDs com dados a completar") : null),
          tr.concluidas ? el("div", { class: "bar", style: "margin-top:6px" }, el("span", { style: `width:${pct(tr.no_prazo, tr.concluidas)}%;background:var(--ok)` })) : null));
    }
    box.replaceChildren(...cards.filter(Boolean));
  }

  // ---------- análises complexas: para entender o que funciona ----------
  function renderComplexas() {
    prepararFiltros();
    const box = $("#an-cards"), d = D.complexas;
    if (D.erro.complexas && !d) return box.replaceChildren(el("p", { class: "err", text: D.erro.complexas }));
    if (!d || D.chave.complexas !== chaveAnalises()) return box.replaceChildren(carregandoEl());
    marcarAtualizado("complexas");
    $("#an-sub").textContent = `Para entender o que funciona, ${textoPeriodo()}. Só totais: nenhum dado pessoal.`;
    const ef = d.eficacia, ab = d.ativacao_bloqueio, es = d.escada, ra = d.resposta_ativacao;
    const tab = (cols, linhas, vazioTxt) => linhas.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela(cols, linhas, ""))) : el("p", { class: "meta", text: vazioTxt });
    const td = (v, num) => el("td", { class: num ? "num" : null, text: v == null ? "—" : String(v) });
    box.replaceChildren(...[
      card("Eficácia da punição", "Depois de cada punição, quantos entregadores voltaram a receber restrição em até 30 dias. Quanto menor a porcentagem, mais a punição funcionou. Só entram restrições com 30 dias ou mais.",
        tab([["Punição"], ["Restrições", 1], ["Voltaram em 30 dias", 1], ["%", 1]],
          ef.map((x) => el("tr", {}, td(x.punicao), td(x.bloqueios, 1), td(x.reincidiram_30d, 1), td(n(x.pct) + "%", 1))), "Ainda não há restrições com 30 dias no período.")),
      card("Qual infração mais se repete", "Dos entregadores com restrição por cada infração no período, quantos já tiveram essa mesma infração duas vezes ou mais (todo o histórico).",
        tab([["Infração"], ["Restrições", 1], ["Entregadores", 1], ["Repetiram", 1], ["%", 1]],
          d.reincidencia_por_infracao.map((x) => el("tr", {}, td(x.infracao), td(x.bloqueios, 1), td(x.entregadores, 1), td(x.repetiram, 1), td(n(x.pct) + "%", 1))), "Poucos dados no período.")),
      card("Escada da reincidência", "Dos entregadores com restrição no período, quantas restrições cada um já soma no histórico. Muita gente nos degraus de cima = a punição não está segurando.",
        el("div", { class: "destaques" }, destaque(es.entregadores, "entregadores com restrição no período"),
          destaque(es.entregadores ? n(pct(es.faixas.slice(1).reduce((s, f) => s + f.qtd, 0), es.entregadores)) + "%" : null, "já têm 2 ou mais")),
        ...barras(es.faixas.map((f) => ({ rotulo: App.u.restricao(f.faixa), qtd: f.qtd })), "var(--bad)", "Nenhuma restrição no período.")),
      card("Cidades", "Volume e gravidade por cidade: restrições por entregador, reincidentes (mesma infração 2 vezes ou mais), encerramentos e infrações leves.",
        tab([["Cidade"], ["Restrições", 1], ["Entregadores", 1], ["Por entregador", 1], ["Reincidentes", 1], ["Encerramentos", 1], ["Leves", 1]],
          d.cidades.map((x) => el("tr", {}, td(x.cidade), td(x.bloqueios, 1), td(x.entregadores, 1), td(n(x.por_entregador), 1), td(x.reincidentes, 1), td(x.encerramentos, 1), td(x.leves, 1))), "Nenhuma restrição no período.")),
      card("Tempo de resposta da ativação", "Do envio do cadastro à primeira decisão (aprovar, reprovar ou encerrar), em horas (mediana): por quem decidiu e pelo dia em que o cadastro chegou.",
        tab([["Quem decidiu"], ["Decisões", 1], ["Aprovou", 1], ["Horas (mediana)", 1]],
          ra.por_pessoa.map((x) => el("tr", {}, td(x.pessoa), td(x.decisoes, 1), td(x.aprovou, 1), td(n(x.horas_mediana), 1))), "Nenhuma decisão no período."),
        ra.por_dia.length ? el("div", {}, el("h4", { class: "an-sub", text: "Horas até a 1ª decisão, pelo dia do envio" }),
          ...barras(ra.por_dia.map((x) => ({ rotulo: `${DIAS_LONGOS[x.dia]} (${x.enviados} enviados)`, qtd: Number(x.horas_mediana) || 0, extra: n(x.horas_mediana) + " h" })), "var(--warn)", "")) : null),
      card("Punições desfeitas", "Restrições liberadas antes do prazo (ou encerramentos revertidos), por infração. Muita liberação numa infração pode indicar regra dura demais ou registro sem prova.",
        tab([["Infração"], ["Restrições", 1], ["Liberados antes", 1], ["%", 1], ["Horas até liberar (média)", 1]],
          d.liberacoes.map((x) => el("tr", {}, td(x.infracao), td(x.bloqueios, 1), td(x.liberados, 1), td(n(x.pct) + "%", 1), td(n(x.horas_media), 1))), "Nenhuma punição desfeita no período.")),
      D.mAtiv ? card("Ativação por cidade", "Todos os cadastros recebidos, por cidade (desde o início).",
        tab([["Cidade"], ["Recebidos", 1], ["Em andamento", 1], ["Aprovados", 1], ["Reprovações", 1], ["Encerrados", 1], ["Tempo até aprovação", 1]],
          D.mAtiv.por_cidade.map((c) => el("tr", {}, td(c.cidade), td(c.recebidos, 1), td(c.em_andamento, 1), td(c.aprovados, 1), td(c.reprovacoes, 1), td(c.encerrados, 1), td(horas(c.horas_ate_aprovacao), 1))),
          "Nenhum cadastro ainda.")) : null,
      card("Por pessoa", "O que cada pessoa fez. Ativação: desde o início; restrições: no período escolhido.",
        D.mAtiv ? el("h4", { class: "an-sub", text: "Ativação" }) : null,
        D.mAtiv ? tab([["Pessoa"], ["Acesso"], ["Enviados", 1], ["Envios por dia (14 dias)", 1], ["Aprovou", 1], ["Reprovou", 1], ["Encerrou", 1]],
          D.mAtiv.por_pessoa.map((p) => el("tr", {}, td(p.id === S.me.id ? `${p.nome} (você)` : p.nome), td(PAPEL[p.papel]), td(p.enviados, 1),
            td((p.enviados_14d / 14).toFixed(1).replace(".", ","), 1), td(p.aprovou, 1), td(p.reprovou, 1), td(p.encerrou, 1))), "Sem atividade.") : null,
        D.mBloq ? el("h4", { class: "an-sub", text: "Restrições" }) : null,
        D.mBloq ? tab([["Pessoa"], ["Restrições", 1], ["Leves", 1], ["Tratou", 1]],
          D.mBloq.por_pessoa.map((x) => el("tr", {}, td(x.nome === S.me.nome ? `${x.nome} (você)` : x.nome), td(x.registrou - x.leves, 1), td(x.leves, 1), td(x.tratou, 1))), "Sem atividade no período.") : null),
      card("Tratativas por responsável", `Tratativas criadas no período (sem as importadas da planilha). O prazo é de ${S.resumo?.prazo_tratativa_horas ?? 32} h.`,
        tab([["Responsável"], ["Total", 1], ["Concluídas", 1], ["Tempo médio (h)", 1], ["Fora do prazo", 1], ["Pendentes", 1], ["Atrasadas agora", 1]],
          d.tratativas_por_responsavel.map((x) => el("tr", {}, td(x.responsavel), td(x.total, 1), td(x.concluidas, 1), td(n(x.horas_media), 1), td(x.fora_do_prazo, 1), td(x.pendentes, 1),
            el("td", { class: "num" + (x.atrasadas_agora ? " err" : ""), text: x.atrasadas_agora }))), "Nenhuma tratativa no período.")),
      card("Da ativação à restrição", "Dos entregadores aprovados em cada mês, quantos levaram uma restrição em até 30, 60 e 90 dias depois da aprovação. Um mês só entra na conta de 60 ou 90 dias quando já passou esse tempo.",
        el("div", { class: "destaques" }, destaque(ab.aprovados, "aprovados pelo sistema"), destaque(ab.bloqueados, "com restrição depois"),
          destaque(ab.aprovados ? n(pct(ab.bloqueados, ab.aprovados)) + "%" : null, "do total"), destaque(ab.dias_medios, "dias até a 1ª restrição (média)")),
        ab.aprovados && ab.aprovados < 20 ? el("p", { class: "alerta-revisar bloco", text: "Base ainda pequena: os números ficam mais confiáveis com mais meses de ativação pelo sistema." }) : null,
        ab.meses.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Mês"], ["Aprovados", 1], ["Em 30 dias", 1], ["Em 60 dias", 1], ["Em 90 dias", 1]],
          ab.meses.map((m) => {
            const faixa = (b, mad) => (mad ? `${b} (${n(pct(b, mad))}%)` + (mad < m.aprovados ? "*" : "") : "—");
            return el("tr", {}, el("td", { text: m.mes.split("-").reverse().join("/") }), el("td", { class: "num", text: m.aprovados }),
              el("td", { class: "num", text: faixa(m.bloq_30, m.maduro_30) }), el("td", { class: "num", text: faixa(m.bloq_60, m.maduro_60) }), el("td", { class: "num", text: faixa(m.bloq_90, m.maduro_90) }));
          }), ""))) : el("p", { class: "meta", text: "Nenhum cadastro aprovado pelo sistema ainda." }),
        ab.meses.some((m) => m.maduro_90 < m.aprovados) ? el("p", { class: "an-nota", text: "* conta só os aprovados que já completaram o prazo; — = ninguém do mês completou o prazo ainda." }) : null)].filter(Boolean));
  }
  document.querySelectorAll("[data-an-periodo]").forEach((b) => b.addEventListener("click", () => {
    A.periodo = b.dataset.anPeriodo === "tudo" ? "tudo" : Number(b.dataset.anPeriodo); render(); App.carregar();
  }));
  document.querySelectorAll("select.an-cidade").forEach((sel) => sel.addEventListener("change", (e) => { A.cidade = e.target.value; render(); App.carregar(); }));

  // ---------- resumo semanal ----------
  const fmtDia = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const rotuloSemana = (ini) => {
    const f = new Date(ini + "T12:00:00"); f.setDate(f.getDate() + 6);
    return `terça ${fmtDia(ini)} a segunda ${fmtDia(f.toISOString().slice(0, 10))}`;
  };
  const IND = [
    ["Ativação", "Cadastros enviados", (r) => r.ativacao.enviados],
    ["Ativação", "Aprovados", (r) => r.ativacao.aprovados, "bom"],
    ["Ativação", "Reprovados", (r) => r.ativacao.reprovados],
    ["Ativação", "Encerrados", (r) => r.ativacao.encerrados],
    ["Ativação", "Tempo médio do envio à aprovação (h)", (r) => r.ativacao.horas_ate_aprovacao, "ruim"],
    ["Restrições", "Restrições registradas", (r) => r.bloqueios.registrados, "ruim"],
    ["Restrições", "Entregadores com registro (restrição ou leve)", (r) => r.bloqueios.entregadores],
    ["Restrições", "Reincidências (2ª ocorrência ou mais)", (r) => r.bloqueios.reincidencias, "ruim"],
    ["Restrições", "Encerramentos de parceria", (r) => r.bloqueios.encerramentos, "ruim"],
    ["Restrições", "Infrações leves", (r) => r.bloqueios.leves, "ruim"],
    ["Restrições", "Restrições geradas por leves", (r) => r.bloqueios.gerados_por_leves, "ruim"],
    ["Restrições", "Liberados antes do prazo", (r) => r.bloqueios.liberados_antes],
    ["Restrições", "Encerramentos revertidos", (r) => r.bloqueios.revertidos],
    ["Tratativas", "Criadas", (r) => r.tratativas.criadas],
    ["Tratativas", "Concluídas", (r) => r.tratativas.concluidas, "bom"],
    ["Tratativas", "Concluídas fora do prazo", (r) => r.tratativas.fora_do_prazo, "ruim"],
    ["Tratativas", "Tempo médio até concluir (h)", (r) => r.tratativas.horas_media, "ruim"],
    ["Tratativas", "Pendentes no fim da semana", (r) => r.tratativas.pendentes_no_fim, "ruim"],
    ["Atividades", "Atividades sugeridas", (r) => r.atividades.criadas],
    ["Atividades", "Atividades concluídas", (r) => r.atividades.concluidas, "bom"],
  ];
  const semanaAnterior = (ini) => { const d = new Date(ini + "T12:00:00"); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); };
  const semanaComparada = () => (!A.semana ? null : A.comparar === "anterior" ? semanaAnterior(A.semana) : A.comparar || null);
  async function buscarSemana(ini) {
    // semanas fechadas não mudam: ficam guardadas; a atual sempre recarrega
    const c = A.resumo[ini];
    if (c && !c.em_andamento && !c.futura) return c;
    return (A.resumo[ini] = await rpc("resumo_semanal", { p_data: ini || null }));
  }
  async function carregarResumo() {
    try {
      if (!A.semana) { const r = await rpc("resumo_semanal", {}); A.semanas = r.semanas; A.semana = r.inicio; A.resumo[r.inicio] = r; }
      await Promise.all([buscarSemana(A.semana), semanaComparada() ? buscarSemana(semanaComparada()) : null]);
      A.erro = null;
    } catch (e) { A.erro = msgErro(e); }
  }
  function diferenca(a, b, sentido) {
    if (a == null || b == null) return el("td", { class: "num", text: "—" });
    const dif = Math.round((a - b) * 10) / 10;
    const p = b ? Math.round((100 * (a - b)) / b) : null;
    const txt = dif === 0 ? "=" : `${dif > 0 ? "+" : ""}${n(dif)}${p != null ? ` (${p > 0 ? "+" : ""}${p}%)` : ""}`;
    const cor = !sentido || !dif ? "" : (dif > 0) === (sentido === "bom") ? " melhor" : " pior";
    return el("td", { class: "num dif" + cor, text: txt });
  }
  function preencherSemanas() {
    const s1 = $("#rs-semana"), s2 = $("#rs-comparar");
    if (!A.semanas || s1.dataset.sig === A.semanas.join()) return;
    s1.dataset.sig = A.semanas.join();
    s1.replaceChildren(...A.semanas.map((w, i) => el("option", { value: w, text: rotuloSemana(w) + (i === 0 ? " (atual)" : "") })));
    s2.replaceChildren(el("option", { value: "anterior", text: "Semana anterior" }), el("option", { value: "", text: "Sem comparação" }),
      ...A.semanas.map((w) => el("option", { value: w, text: rotuloSemana(w) })));
    s1.value = A.semana; s2.value = A.comparar;
  }
  function linhasResumo() {
    const r = A.resumo[A.semana], c = semanaComparada() ? A.resumo[semanaComparada()] : null;
    return IND.map(([grupo, nome, f, sentido]) => ({ grupo, nome, a: f(r), b: c ? f(c) : null, sentido }));
  }
  function renderResumo() {
    preencherSemanas();
    const box = $("#rs-corpo");
    if (A.erro && !A.resumo[A.semana]) return box.replaceChildren(el("p", { class: "err", text: A.erro }));
    const r = A.resumo[A.semana], cmp = semanaComparada(), c = cmp ? A.resumo[cmp] : null;
    if (!r || (cmp && !c)) return box.replaceChildren(carregandoEl());
    $("#rs-titulo").textContent = `Resumo semanal: ${rotuloSemana(r.inicio)}${r.em_andamento ? " (em andamento)" : ""}`;
    let grupo = null;
    const linhas = [];
    for (const x of linhasResumo()) {
      if (x.grupo !== grupo) { grupo = x.grupo; linhas.push(el("tr", {}, el("th", { colspan: c ? 4 : 2, text: grupo, style: "text-align:left;background:var(--bg)" }))); }
      linhas.push(el("tr", {}, el("td", { text: x.nome }), el("td", { class: "num", text: n(x.a) }),
        c ? el("td", { class: "num", text: n(x.b) }) : null, c ? diferenca(x.a, x.b, x.sentido) : null));
    }
    const top = (titulo, lista, rot, val) => el("div", { class: "panel" }, el("h3", { text: titulo }),
      ...barras(lista.map((x) => ({ rotulo: rot(x), qtd: val(x) })), "var(--accent)", "Nada nesta semana."));
    box.replaceChildren(
      el("div", { class: "panel" },
        r.em_andamento ? el("p", { class: "alerta-revisar bloco", text: "Semana em andamento: os números ainda vão mudar até segunda-feira." }) : null,
        el("div", { class: "tablewrap" }, el("table", {},
          el("thead", {}, el("tr", {}, el("th", { text: "Indicador" }), el("th", { class: "num", text: rotuloSemana(r.inicio) }),
            c ? el("th", { class: "num", text: rotuloSemana(c.inicio) }) : null, c ? el("th", { class: "num", text: "Diferença" }) : null)),
          el("tbody", {}, linhas))),
        c ? el("p", { class: "an-nota", text: "Na diferença, verde = melhorou e vermelho = piorou. Números sem cor (como cadastros enviados) não são bons nem ruins por si." }) : null),
      el("div", { class: "an-grid" },
        top("Infrações da semana", r.por_infracao, (x) => x.infracao + (x.leve ? " (leve)" : ""), (x) => x.total),
        top("Cidades da semana", r.por_cidade, (x) => x.cidade, (x) => x.total),
        el("div", { class: "panel" }, el("h3", { text: "Por pessoa" }),
          r.por_pessoa.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Pessoa"], ["Restrições", 1], ["Leves", 1], ["Cadastros", 1], ["Decisões", 1], ["Tratativas", 1]],
            r.por_pessoa.map((p) => el("tr", {}, el("td", { text: p.nome }), el("td", { class: "num", text: p.bloqueios }), el("td", { class: "num", text: p.leves }),
              el("td", { class: "num", text: p.cadastros }), el("td", { class: "num", text: p.decisoes }), el("td", { class: "num", text: p.tratativas }))), "")))
            : el("p", { class: "meta", text: "Ninguém registrou nada nesta semana." }))));
  }
  $("#rs-semana").addEventListener("change", (e) => { A.semana = e.target.value; render(); App.carregar(); });
  $("#rs-comparar").addEventListener("change", (e) => { A.comparar = e.target.value; render(); App.carregar(); });
  $("#rs-csv").addEventListener("click", () => {
    const r = A.resumo[A.semana], c = semanaComparada() ? A.resumo[semanaComparada()] : null;
    if (!r) return;
    const linhas = linhasResumo().map((x) => [x.grupo, x.nome, x.a, c ? x.b : "", c && x.a != null && x.b != null ? Math.round((x.a - x.b) * 10) / 10 : ""]);
    for (const i of r.por_infracao) linhas.push(["Infrações da semana", i.infracao + (i.leve ? " (leve)" : ""), i.total, "", ""]);
    for (const i of r.por_cidade) linhas.push(["Cidades da semana", i.cidade, i.total, "", ""]);
    for (const p of r.por_pessoa) linhas.push(["Por pessoa", p.nome, p.total, "", ""]);
    baixarCSV(`resumo-semanal-${r.inicio}`, ["grupo", "indicador", rotuloSemana(r.inicio), c ? rotuloSemana(c.inicio) : "comparacao", "diferenca"], linhas);
  });
  // PDF: a janela de impressão do navegador, com "Salvar como PDF", mostrando só o resumo
  $("#rs-pdf").addEventListener("click", () => {
    const sec = $("#v-an-resumo");
    sec.classList.add("imprimir");
    const titulo = document.title;
    document.title = `Resumo semanal ${A.semana}`;
    addEventListener("afterprint", () => { sec.classList.remove("imprimir"); document.title = titulo; }, { once: true });
    print();
  });

  // 009z4 (A16-07): uso das telas e botões, sem saber quem (só o administrador final)
  const USO_TXT = { aba: "Tela", mensagem: "Mensagem copiada", frase: "Frase pronta", busca: "Busca do topo", paleta: "Busca rápida (Ctrl+K)", envio: "Registrado", erro: "Erro ao registrar", botao: "Botão" };
  function renderUso() {
    const box = $("#as-uso");
    box.hidden = !S.me?.admin_final;
    if (box.hidden || !box.open) return;
    const l = $("#as-uso-lista");
    if (!D.uso) return l.replaceChildren(carregandoEl());
    if (D.uso.erro) return l.replaceChildren(el("p", { class: "err", text: D.uso.erro }));
    if (!D.uso.itens.length) return l.replaceChildren(el("p", { class: "meta", text: "Ainda sem números: eles começam a aparecer conforme a equipe usa o app." }));
    l.replaceChildren(el("ol", { class: "lista-num" }, D.uso.itens.map((x) => {
      const [tipo, resto] = String(x.recurso).split(/:(.*)/s);
      return el("li", {}, `${USO_TXT[tipo] || tipo}${resto ? ": " + resto : ""}`, el("span", { class: "meta", text: ` · ${x.qtd} ${x.qtd === 1 ? "vez" : "vezes"} em ${x.dias} ${x.dias === 1 ? "dia" : "dias"}` }));
    })));
  }
  $("#as-uso").addEventListener("toggle", async (e) => {
    if (!e.target.open) return;
    D.uso = null; renderUso();
    App.enviarUso?.();
    try { D.uso = await rpc("uso_resumo", { p_dias: 28 }); } catch (err) { D.uso = { erro: msgErro(err) }; }
    renderUso();
  });


  // ---------- 009z10: Pedidos (dados do Tableau) ----------
  // Os cards desta aba saem de analise_pedidos (supabase/009z10-analises-pedidos.sql). Todos levam o marcador
  // "Tableau" (pedido do usuário), para separar a leva de análises que vem dos arquivos do Tableau.
  const DP = { d: null, chave: "", erro: null, em: 0 };
  const chavePed = () => `${A.periodo}|${A.cidade}`;
  async function carregarPedidos() {
    if (DP.chave === chavePed() && DP.d && Date.now() - DP.em < 300000) return;
    try {
      const args = { p_dias: A.periodo === "tudo" ? null : A.periodo, p_cidade: A.cidade || null };
      const [d, b] = await Promise.all([rpc("analise_pedidos", args), rpc("analise_pedidos_bairros", args).catch(() => null)]);  // 009z13: bairros
      DP.d = d; DP.b = b; DP.chave = chavePed(); DP.erro = null; DP.em = Date.now();
      if (!A.cidades) A.cidades = d.cidades || [];
    } catch (e) { DP.erro = msgErro(e); }
  }
  const marca = () => el("span", { class: "tag-tableau", title: "Análise feita com os dados do Tableau" }, el("i", { "aria-hidden": "true" }), "Tableau");
  const cardT = (titulo, nota, ...conteudo) => el("div", { class: "panel ped-an" },
    el("h3", {}, titulo, " ", marca()), nota ? el("p", { class: "an-nota", text: nota }) : null, ...conteudo.filter(Boolean));
  const pc = (a, b) => (b ? (Math.round((1000 * a) / b) / 10).toFixed(1).replace(".", ",") + "%" : "—");
  const minTxt = (v) => (v == null ? "—" : String(Math.round(Number(v))) + " min");
  const leitura = (txt) => el("p", { class: "ped-leitura", text: txt });
  const tendencia = (agora, antes, menorMelhor = true) => {
    if (agora == null || antes == null) return "sem comparação";
    const d = Math.round((Number(agora) - Number(antes)) * 10) / 10;
    if (Math.abs(d) < 1) return "igual ao período anterior";
    const pior = menorMelhor ? d > 0 : d < 0;
    return `${pior ? "piorou" : "melhorou"} (${d > 0 ? "+" : ""}${String(d).replace(".", ",")})`;
  };
  // mapa de calor com a % de atrasos (só a cor; o número exato no título da célula)
  function mapaPct(lista, LIM) {
    const m = new Map(lista.map((x) => [`${x.dia}-${x.hora}`, x]));
    const vals = lista.filter((x) => x.pedidos >= 10).map((x) => x.atraso / x.pedidos);
    const max = Math.max(0.01, ...vals);
    const cel = [el("span")];
    for (let h = 0; h < 24; h++) cel.push(el("span", { class: "h", text: h % 3 === 0 ? String(h) : "" }));
    for (let d = 0; d < 7; d++) {
      cel.push(el("span", { text: DIAS[d] }));
      for (let h = 0; h < 24; h++) {
        const x = m.get(`${d}-${h}`), ok = x && x.pedidos >= 10, v = ok ? x.atraso / x.pedidos : 0;
        cel.push(el("span", { class: "c", title: x ? `${DIAS_LONGOS[d]}, ${h}h: ${pc(x.atraso, x.pedidos)} acima de ${LIM} (${x.atraso} de ${x.pedidos} pedidos)` : `${DIAS_LONGOS[d]}, ${h}h: sem pedidos`,
          style: ok && x.atraso ? `background:color-mix(in srgb, var(--bad) ${Math.round(15 + (85 * v) / max)}%, transparent)` : null }));
      }
    }
    return el("div", { class: "calor", role: "img", "aria-label": `Porcentagem de pedidos acima de ${LIM} por dia da semana e hora` }, cel);
  }
  // linhas com a cor do nível comparado à média (sempre com o texto: a cor nunca fala sozinha)
  const NIVEIS = [[1.5, "n-alto", "bem acima da média"], [1.1, "n-medio", "acima da média"], [0.9, "n-neutro", "na média"], [0, "n-baixo", "abaixo da média"]];
  function linhasNivel(itens, media, vazioTxt) {
    if (!itens.length) return vazioTxt ? [el("p", { class: "meta", text: vazioTxt })] : [];
    const max = Math.max(0.0001, ...itens.map((x) => x.v));
    return itens.map((x) => {
      const r = media ? x.v / media : 1;
      const [, cls, txt] = NIVEIS.find(([f]) => r >= f) || NIVEIS[3];
      return el("div", { class: `ped-nivel ${cls}` },
        el("div", { class: "ped-nivel-rot" }, el("span", { text: x.rotulo }), el("b", { text: x.extra })),
        el("div", { class: "ped-nivel-barra" }, el("span", { style: `width:${Math.max(2, Math.round((100 * x.v) / max))}%` })),
        el("span", { class: "ped-nivel-txt", text: txt }));
    });
  }
  const irLoja = (loja) => { if (App.pedidos?.P) { Object.assign(App.pedidos.P.filtros, { loja, tipo: "", situacao: "" }); App.pedidos.P.limite = 50; } location.hash = "#monitoramento/pedidos"; };
  function tabelaLojas(lista, colunas) {
    if (!lista.length) return el("p", { class: "meta", text: "Nenhuma loja com 30 pedidos ou mais no período." });
    return el("div", { class: "tablewrap" }, el("table", { class: "ped-lojas" },
      el("thead", {}, el("tr", {}, el("th", { text: "Loja" }), ...colunas.map(([t]) => el("th", { text: t })))),
      el("tbody", {}, lista.map((l) => el("tr", {},
        el("td", {}, el("button", { class: "btn link", type: "button", title: "Ver os pedidos desta loja no Monitoramento", onclick: () => irLoja(l.loja) }, l.loja)),
        ...colunas.map(([, f]) => el("td", { text: f(l) })))))));
  }
  function renderPedidosAn() {
    prepararFiltros();
    const box = $("#ap-cards"), d = DP.d;
    if (DP.erro && !d) return box.replaceChildren(el("p", { class: "err", text: DP.erro }));
    if (!d || DP.chave !== chavePed()) return box.replaceChildren(carregandoEl());
    document.querySelectorAll("#v-an-pedidos [data-an-atualizado]").forEach((x) => x.replaceChildren(
      `Números de ${new Date(DP.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: App.u.FUSO })} `,
      el("button", { class: "btn link small", type: "button", onclick: () => { DP.em = 0; App.carregar(); } }, "Atualizar")));
    if (d.vazio) return box.replaceChildren(d.antigos
      ? vazio("Reenvie os arquivos do Tableau", `As análises agora contam como atraso o pedido com mais de ${d.atraso_min || 30} min. Para os dias que já estavam no banco entrarem nessa conta, um moderador precisa reenviar os arquivos em Monitoramento → Enviar dados.`)
      : vazio("Ainda não há pedidos do Tableau", "Quando um moderador enviar os arquivos em Monitoramento → Enviar dados, as análises aparecem aqui."));
    $("#ap-sub").textContent = `Pedidos de ${App.u.dia(d.de)} a ${App.u.dia(d.ate)} (o último dia com dados), vindos dos arquivos do Tableau. Atraso = mais de ${d.atraso_min || 30} min do chamado até a entrega.`;
    const t = d.totais, ro = d.rota, en = d.entregador, lim = d.atraso_min || 30;
    const LIM = `${lim} min`;
    // A. quando (009z11: frase de uso, os 5 horários mais críticos e o mapa completo fechado)
    const media = t.pedidos ? t.atraso / t.pedidos : 0;
    const porDia = d.por_dia_semana.filter((x) => x.pedidos >= 30).map((x) => ({ ...x, v: x.atraso / x.pedidos }));
    const piorDia = porDia.reduce((m, x) => (!m || x.v > m.v ? x : m), null);
    const celulas = d.mapa.filter((x) => x.pedidos >= 30).map((x) => ({ ...x, v: x.atraso / x.pedidos })).sort((a, b) => b.v - a.v);
    const faixa = (h) => `${h}h às ${(h + 1) % 24}h`;
    const criticos = celulas.slice(0, 5);
    const pior = criticos[0];
    const cA = cardT("Quando o atraso acontece", `Para saber em que dias e horários reforçar a escala de entregadores. Atraso = mais de ${LIM} do chamado até a entrega. Só entram horários com 30 pedidos ou mais.`,
      el("div", { class: "destaques" }, destaque(t.pedidos, "pedidos"), destaque(pc(t.atraso, t.pedidos), `passaram de ${LIM}`),
        piorDia ? destaque(DIAS_LONGOS[piorDia.dia], `pior dia (${pc(piorDia.atraso, piorDia.pedidos)})`) : null),
      pior ? leitura(`O pior horário é ${DIAS_LONGOS[pior.dia]}, das ${faixa(pior.hora)}: ${pc(pior.atraso, pior.pedidos)} dos pedidos passam de ${LIM}, contra ${pc(t.atraso, t.pedidos)} na média. Comece reforçando a escala nos horários abaixo.`) : null,
      el("h4", { text: "Os 5 horários mais críticos" }),
      ...linhasNivel(criticos.map((x) => ({ rotulo: `${DIAS_LONGOS[x.dia]}, ${faixa(x.hora)}`, v: x.v, extra: `${pc(x.atraso, x.pedidos)} · ${x.atraso} de ${x.pedidos}` })), media, "Sem horários com pedidos suficientes."),
      el("h4", { text: "Por dia da semana" }),
      ...linhasNivel(porDia.map((x) => ({ rotulo: DIAS_LONGOS[x.dia], v: x.v, extra: `${pc(x.atraso, x.pedidos)} · ${x.atraso} de ${x.pedidos}` })), media, "Sem pedidos suficientes."),
      el("details", { class: "ped-mais" }, el("summary", { text: "Ver o mapa completo (dia da semana × hora)" }),
        el("p", { class: "meta", text: "Quanto mais vermelho, maior a parte dos pedidos que passou do limite. Passe o mouse sobre um quadrinho para ver o número." }),
        mapaPct(d.mapa, LIM)));
    largo(cA);
    // B. rota
    const soz = t.pedidos - ro.em_rota;
    const mediaRota = ro.em_rota ? ro.em_rota_atraso / ro.em_rota : 0;
    const rotaHora = ro.por_hora.filter((x) => x.em_rota >= 30).map((x) => ({ ...x, v: x.em_rota_atraso / x.em_rota }));
    const linhaRota = (x) => ({ rotulo: faixa(x.hora), v: x.v, extra: `${pc(x.em_rota_atraso, x.em_rota)} das rotas atrasam · ${pc(x.em_rota, x.pedidos)} saem em rota` });
    const cB = cardT("Rota com vários pedidos", "Quando o entregador sai da loja levando mais de um pedido (saíram com até 5 minutos de diferença). O último da rota naturalmente demora mais.",
      el("div", { class: "destaques" },
        destaque(pc(ro.em_rota, t.pedidos), "dos pedidos saem em rota"),
        destaque(pc(ro.em_rota_atraso, ro.em_rota), `em rota passam de ${LIM}`),
        destaque(pc(ro.sozinho_atraso, soz), `sozinho passam de ${LIM}`),
        destaque(pc(ro.causa_rota, ro.atraso), "dos atrasos vieram de rota")),
      el("div", { class: "destaques" }, destaque(minTxt(ro.media_cliente_rota), "da loja ao cliente em rota"), destaque(minTxt(ro.media_cliente_so), "da loja ao cliente sozinho")),
      leitura(ro.em_rota && soz && ro.sozinho_atraso ? `Em rota, a chance de passar de ${LIM} é ${String(Math.round(((ro.em_rota_atraso / ro.em_rota) / (ro.sozinho_atraso / soz)) * 10) / 10).replace(".", ",")} vezes maior do que saindo sozinho.` : "Sem dados de rota suficientes no período."),
      el("h4", { text: "Horários em que a rota mais atrasa" }),
      ...linhasNivel([...rotaHora].sort((a, b) => b.v - a.v).slice(0, 5).map(linhaRota), mediaRota, "Sem horários com rotas suficientes."),
      rotaHora.length > 5 ? el("details", { class: "ped-mais" }, el("summary", { text: "Ver todos os horários" }), ...linhasNivel(rotaHora.map(linhaRota), mediaRota, "")) : null);
    // C. entregador
    const entHora = en.por_hora.filter((x) => x.pedidos >= 30).map((x) => ({ ...x, v: (x.chegada15 + x.entrega35) / x.pedidos }));
    const mediaEnt = t.pedidos ? (en.chegada15 + en.entrega35) / t.pedidos : 0;
    const linhaEnt = (x) => ({ rotulo: faixa(x.hora), v: x.v, extra: `${x.chegada15} até chegar na loja · ${x.entrega35} até entregar` });
    const cC = cardT("Atraso do entregador", "Os casos em que a demora foi do entregador: levou mais de 15 min do aceite até chegar na loja, ou mais de 35 min do aceite até entregar saindo sozinho.",
      el("div", { class: "destaques" }, destaque(en.chegada15, "demoraram até chegar na loja"), destaque(en.entrega35, "demoraram até entregar, saindo sozinhos")),
      el("h4", { text: "Horários com mais casos" }),
      el("p", { class: "meta", text: "A cor compara os casos com o número de pedidos de cada horário." }),
      ...linhasNivel([...entHora].sort((a, b) => b.v - a.v).slice(0, 5).map(linhaEnt), mediaEnt, "Nenhum caso no período."),
      entHora.length > 5 ? el("details", { class: "ped-mais" }, el("summary", { text: "Ver todos os horários" }), ...linhasNivel(entHora.map(linhaEnt), mediaEnt, "")) : null,
      el("h4", { text: "Quem mais repete" }),
      en.quem.length ? el("div", { class: "tablewrap" }, el("table", {},
        el("thead", {}, el("tr", {}, ...["Entregador", "Casos", "Até chegar na loja", "Até entregar", "Restrições"].map((x) => el("th", { text: x })))),
        el("tbody", {}, en.quem.map((q) => el("tr", {},
          el("td", {}, el("button", { class: "btn link link-ficha", type: "button", onclick: () => App.abrirFicha?.(q.id) }, q.nome || q.id)),
          el("td", { text: String(q.casos) }), el("td", { text: String(q.chegada) }), el("td", { text: String(q.entrega) }), el("td", { text: String(q.restricoes) })))))) :
        el("p", { class: "meta", text: "Ninguém no período." }));
    // D. lojas (um card por tipo de lentidão)
    const L = d.lojas || [];
    const top = (f, ord) => L.filter(f).sort(ord).slice(0, 10);
    const cD1 = cardT("Lojas: preparo longo", "Do pedido do cliente até a loja chamar o entregador. Preparo longo atrasa o pedido antes de o entregador entrar na história. Lojas com 30 pedidos ou mais.",
      tabelaLojas(top((l) => l.preparo_medio != null, (a, b) => b.preparo_medio - a.preparo_medio), [
        ["Pedidos", (l) => String(l.pedidos)], ["Preparo médio", (l) => minTxt(l.preparo_medio)],
        ["Acima de 30 min", (l) => pc(l.preparo30, l.n_preparo)], ["Hora em que mais demora", (l) => (l.pior_hora == null ? "—" : `${l.pior_hora}h (${minTxt(l.pior_hora_preparo)})`)],
        ["Período anterior", (l) => tendencia(l.preparo_medio, l.antes?.preparo_medio)]]));
    const cD2 = cardT("Lojas: espera na loja", "O entregador chegou e esperou para sair com o pedido. Espera acima de 10 min não conta contra o entregador.",
      tabelaLojas(top((l) => l.espera_media != null && l.n_espera >= 10, (a, b) => b.espera_media - a.espera_media), [
        ["Pedidos", (l) => String(l.pedidos)], ["Espera média", (l) => minTxt(l.espera_media)],
        ["Acima de 10 min", (l) => pc(l.espera10, l.n_espera)], ["Período anterior", (l) => tendencia(l.espera_media, l.antes?.espera_media)]]));
    const cD3 = cardT(`Lojas: pedidos acima de ${LIM}`, `Do chamado até a entrega. “Esperaram na loja” conta os atrasados em que o entregador esperou mais de 10 min na loja, mesmo que o atraso tenha tido outra causa.`,
      tabelaLojas(top(() => true, (a, b) => b.atraso / b.pedidos - a.atraso / a.pedidos), [
        ["Pedidos", (l) => String(l.pedidos)], [`Acima de ${LIM}`, (l) => pc(l.atraso, l.pedidos)],
        ["Esperaram na loja", (l) => (l.atraso ? `${l.espera_loja} de ${l.atraso} atrasados` : "—")],
        ["Período anterior", (l) => (l.antes ? tendencia(100 * l.atraso / l.pedidos, 100 * l.antes.atraso / l.antes.pedidos) : "sem dados antes")]]));
    // D4. bairros (009z13, pedido do usuário): onde a entrega mais demora
    const B = DP.b, mediaB = B && B.pedidos ? B.atraso / B.pedidos : 0;
    const linhaB = (x) => ({ rotulo: x.bairro, v: x.atraso / x.pedidos,
      extra: `${pc(x.atraso, x.pedidos)} · ${x.atraso} de ${x.pedidos} · ${minTxt(x.media_cliente)} da loja ao cliente${x.antes ? " · " + tendencia(100 * x.atraso / x.pedidos, 100 * x.antes.atraso / x.antes.pedidos) : ""}` });
    const listaB = B && !B.vazio ? B.bairros || [] : [];
    const cD4 = cardT("Bairros: onde a entrega mais demora", `Parte dos pedidos de cada bairro que passou de ${LIM}, e o tempo médio da loja até o cliente. Bairros com 30 pedidos ou mais.`,
      !B || B.vazio ? el("p", { class: "meta", text: "O bairro da entrega começou a ser guardado agora: aparece depois do próximo envio dos arquivos do Tableau." }) : null,
      ...(B && !B.vazio ? linhasNivel(listaB.slice(0, 10).map(linhaB), mediaB, "Nenhum bairro com 30 pedidos ou mais no período.") : []),
      listaB.length > 10 ? el("details", { class: "ped-mais" }, el("summary", { text: "Ver todos os bairros" }), ...linhasNivel(listaB.slice(10).map(linhaB), mediaB, "")) : null);
    [cD1, cD2, cD3, cD4].forEach(largo);
    // E. causas por semana (009z11: a causa é a etapa que mais passou do próprio limite)
    const CAUSAS = [["entregador", "Entregador", "var(--bad)"], ["loja", "Espera na loja", "var(--ambar)"], ["aceite", "Demora para aceitar", "var(--accent)"],
      ["rota", "Rota com vários pedidos", "var(--warn)"], ["outras", "Soma de pequenas demoras", "var(--gray)"]];
    const cE = cardT("De onde veio o atraso, por semana", `Cada pedido acima de ${LIM} entra na etapa que mais passou do próprio limite. “Soma de pequenas demoras” = nenhuma etapa passou do limite, mas juntas passaram de ${LIM}. Semanas de terça a segunda.`,
      el("div", { class: "legend" }, CAUSAS.map(([, nome, cor]) => el("span", {}, el("i", { style: `background:${cor}` }), nome))),
      el("div", { class: "ped-semanas" }, d.causas_semana.map((w) => {
        const tot = CAUSAS.reduce((s, [k]) => s + w[k], 0);
        return el("div", { class: "ped-semana" },
          el("div", { class: "ped-semana-rot" }, el("span", { text: `Semana de ${App.u.dia(w.semana)}` }), el("b", { text: `${w.atraso} de ${w.pedidos} (${pc(w.atraso, w.pedidos)})` })),
          el("div", { class: "ped-pilha", role: "img", "aria-label": CAUSAS.map(([k, nome]) => `${nome}: ${w[k]}`).join(", ") },
            ...CAUSAS.filter(([k]) => w[k]).map(([k, nome, cor]) => el("span", { title: `${nome}: ${w[k]}`, style: `flex-grow:${w[k]};background:${cor}` }))),
          tot ? null : el("p", { class: "meta", text: "Nenhum atraso." }));
      })));
    largo(cE);
    box.replaceChildren(cA, cB, cC, cD1, cD2, cD3, cD4, cE);
  }
  App.modulo({
    id: "analises", nome: "Análises",
    abas: [
      { id: "simples", nome: "Análises simples", secao: "v-an-simples" },
      { id: "complexas", nome: "Análises complexas", secao: "v-an-analises" },
      { id: "resumo", nome: "Resumo semanal", secao: "v-an-resumo" },
      { id: "tarefas", nome: "Painel das tarefas", secao: "v-at-painel" },  // 009m: o Painel das tarefas (antes em Atividades)
      { id: "pedidos", nome: "Pedidos", secao: "v-an-pedidos", pode: () => !!S.me?.papel_bloqueios },  // 009z10: dados do Tableau
    ],
    padrao: () => "simples",
    carregar: (aba) => (aba === "pedidos" ? carregarPedidos() : aba === "tarefas" ? App.painel.carregar() : aba === "resumo" ? carregarResumo() : carregarAnalises(aba === "complexas" ? "complexas" : "simples")),
    render: (aba) => (aba === "pedidos" ? renderPedidosAn() : aba === "tarefas" ? App.painel.render() : aba === "resumo" ? renderResumo() : aba === "complexas" ? renderComplexas() : (renderSimples(), renderUso())),
  });
})();
