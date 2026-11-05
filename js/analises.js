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
    try {
      const dias = A.periodo === "tudo" ? null : A.periodo;
      const [d, ma, mb] = await Promise.all([
        rpc(tipo === "simples" ? "analises_simples" : "analises_complexas", { p_dias: dias, p_cidade: A.cidade || null }),
        rpc("metricas", {}),
        S.me.papel_bloqueios ? rpc("metricas_bloqueios", { p_dias: dias, p_cidade: A.cidade || null }) : null]);
      if (chave === chaveAnalises()) { D[tipo] = d; D.mAtiv = ma; D.mBloq = mb; D.chave[tipo] = chave; D.erro[tipo] = null; }
    } catch (e) { D.erro[tipo] = msgErro(e); }
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
        card("Bloqueios agora", "Quem está bloqueado neste momento e quem sai hoje (o fim do prazo libera sozinho).",
          el("div", { class: "destaques" }, destaque(ag.bloqueados, "bloqueados agora"), destaque(ag.saem_hoje, "saem do bloqueio hoje"),
            destaque(ag.sairam_hoje, "já saíram hoje"), destaque(ag.liberados_antes_hoje, "liberados antes do prazo hoje")),
          el("div", { class: "destaques" }, destaque(ag.tratativas_pendentes, "tratativas pendentes"),
            el("div", { class: ag.tratativas_atrasadas ? "alerta" : null }, el("b", { text: n(ag.tratativas_atrasadas) }), el("span", { text: "atrasadas" })),
            destaque(ag.encerramentos_pendentes, "encerramentos a tratar")),
          ag.saem_hoje ? el("p", { class: "an-nota", text: `O próximo a sair é às ${hhmm(ag.proximo_fim)}.` }) : null,
          ag.saem_hoje ? el("div", {}, el("h4", { class: "an-sub", text: "Saem hoje, por hora" }),
            ...barras(ag.saem_hoje_por_hora.map((x) => ({ rotulo: `${String(x.hora).padStart(2, "0")}h`, qtd: x.qtd })), "var(--ok)", "")) : null),
        card("Bloqueados agora, por cidade", "Onde estão os bloqueados neste momento e quantos saem hoje.",
          d.bloqueados_por_cidade.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Cidade"], ["Bloqueados", 1], ["Saem hoje", 1]],
            d.bloqueados_por_cidade.map((x) => el("tr", {}, el("td", { text: x.cidade }), el("td", { class: "num", text: x.agora }), el("td", { class: "num", text: x.saem_hoje }))), "")))
            : el("p", { class: "meta", text: "Ninguém bloqueado agora." })),
        D.mBloq ? card("Bloqueios por dia", `Bloqueios e infrações leves ${textoPeriodo()}, separando 1ª ocorrência, reincidência e encerramento.`,
          el("div", { class: "legend" }, el("span", {}, el("i", { style: "background:var(--accent)" }), "1ª ocorrência"), el("span", {}, el("i", { style: "background:var(--warn)" }), "Reincidência"),
            el("span", {}, el("i", { style: "background:var(--bad)" }), "Encerramento"), el("span", {}, el("i", { style: "background:var(--gray)" }), "Infração leve")),
          grafico(D.mBloq.por_dia.map((x) => ({ ...x, primeira: x.total - x.leves - x.reincidencias - x.encerramentos })),
            [["primeira", "var(--accent)", "1ª ocorrência"], ["reincidencias", "var(--warn)", "reincidência(s)"], ["encerramentos", "var(--bad)", "encerramento(s)"], ["leves", "var(--gray)", "infração(ões) leve(s)"]],
            null, "Bloqueios por dia")) : null);
    }
    cards.push(
      largo(card("Quando você registra", "Seus bloqueios, infrações leves e cadastros enviados, por dia da semana e hora. Mais escuro = mais registros seus.",
        pMeu ? el("p", { class: "pico" }, "Seu pico: ", el("b", { text: `${pMeu.dia}, por volta das ${pMeu.hora}h` }), ` · ${pMeu.faixaPct}% dos seus registros são de ${pMeu.faixa} · ${pMeu.total} registro(s) no período`) : null,
        pMeu ? mapaCalor(d.dia_hora_meu, "var(--ok)") : el("p", { class: "meta", text: "Você ainda não registrou nada no período." }))),
      largo(card("Quando a equipe registra", "Bloqueios, infrações leves e cadastros de toda a equipe, por dia da semana e hora (sem os importados da planilha).",
        pEq ? el("p", { class: "pico" }, "Pico da equipe: ", el("b", { text: `${pEq.dia}, por volta das ${pEq.hora}h` }), ` · ${pEq.faixaPct}% dos registros são de ${pEq.faixa}`) : null,
        pEq ? mapaCalor(d.dia_hora) : el("p", { class: "meta", text: "Nenhum registro no período." }))),
      card("Você no período", "O que você fez no período escolhido (só você vê os seus números).",
        el("div", { class: "destaques" }, destaque(vc.cadastros, "cadastros enviados"), destaque(vc.decisoes, "decisões na ativação"),
          d.tem_bloqueios ? destaque(vc.bloqueios, "bloqueios") : null, d.tem_bloqueios ? destaque(vc.leves, "infrações leves") : null,
          d.tem_bloqueios ? destaque(vc.tratativas, "tratativas resolvidas") : null, destaque(vc.atividades, "atividades concluídas"),
          d.tem_bloqueios ? destaque(vc.comentarios, "comentários nas fichas") : null)),
      card("Atividades", "Atividades sugeridas entre a equipe.",
        el("div", { class: "destaques" }, destaque(av.abertas_agora, "abertas agora"), destaque(av.em_andamento, "em andamento"),
          destaque(av.sugeridas, "sugeridas no período"), destaque(av.concluidas, "concluídas no período"))));
    if (d.tem_bloqueios) {
      cards.push(
        card("Tempo até reincidir", "Intervalo entre um bloqueio e o seguinte do mesmo entregador.",
          el("div", { class: "destaques" }, destaque(ri.total, "reincidências no período"), destaque(ri.mediana_dias, "dias (mediana)")),
          ...barras(ri.faixas.map((f) => ({ rotulo: f.faixa, qtd: f.qtd })), "var(--warn)", "Nenhuma reincidência no período.")),
        card("Conversão das infrações leves", "Quantos entregadores com infração leve chegaram ao limite e ganharam um bloqueio normal.",
          el("div", { class: "destaques" }, destaque(lv.total, "infrações leves"), destaque(lv.entregadores, "entregadores"),
            destaque(lv.atingiram_limite, "chegaram ao limite"), destaque(lv.entregadores ? n(pct(lv.atingiram_limite, lv.entregadores)) + "%" : null, "conversão"))),
        card("Infrações mais registradas", "Os bloqueios do período por infração (as 8 primeiras).",
          ...barras(d.por_infracao.map((x) => ({ rotulo: x.infracao, qtd: x.qtd, extra: x.encerramentos ? `${x.qtd} · ${x.encerramentos} encerramento(s)` : null })), "var(--accent)", "Nenhum bloqueio no período.")),
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
    $("#an-sub").textContent = `Para entender o que funciona, ${textoPeriodo()}. Só totais: nenhum dado pessoal.`;
    const ef = d.eficacia, ab = d.ativacao_bloqueio, es = d.escada, ra = d.resposta_ativacao;
    const tab = (cols, linhas, vazioTxt) => linhas.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela(cols, linhas, ""))) : el("p", { class: "meta", text: vazioTxt });
    const td = (v, num) => el("td", { class: num ? "num" : null, text: v == null ? "—" : String(v) });
    box.replaceChildren(...[
      card("Eficácia da punição", "Depois de cada punição, quantos entregadores voltaram a ser bloqueados em até 30 dias. Quanto menor a porcentagem, mais a punição funcionou. Só entram bloqueios com 30 dias ou mais.",
        tab([["Punição"], ["Bloqueios", 1], ["Voltaram em 30 dias", 1], ["%", 1]],
          ef.map((x) => el("tr", {}, td(x.punicao), td(x.bloqueios, 1), td(x.reincidiram_30d, 1), td(n(x.pct) + "%", 1))), "Ainda não há bloqueios com 30 dias no período.")),
      card("Qual infração mais se repete", "Dos entregadores bloqueados por cada infração no período, quantos já tiveram essa mesma infração duas vezes ou mais (todo o histórico).",
        tab([["Infração"], ["Bloqueios", 1], ["Entregadores", 1], ["Repetiram", 1], ["%", 1]],
          d.reincidencia_por_infracao.map((x) => el("tr", {}, td(x.infracao), td(x.bloqueios, 1), td(x.entregadores, 1), td(x.repetiram, 1), td(n(x.pct) + "%", 1))), "Poucos dados no período.")),
      card("Escada da reincidência", "Dos entregadores bloqueados no período, quantos bloqueios cada um já soma no histórico. Muita gente nos degraus de cima = a punição não está segurando.",
        el("div", { class: "destaques" }, destaque(es.entregadores, "entregadores bloqueados no período"),
          destaque(es.entregadores ? n(pct(es.faixas.slice(1).reduce((s, f) => s + f.qtd, 0), es.entregadores)) + "%" : null, "já têm 2 ou mais")),
        ...barras(es.faixas.map((f) => ({ rotulo: f.faixa, qtd: f.qtd })), "var(--bad)", "Nenhum bloqueio no período.")),
      card("Cidades", "Volume e gravidade por cidade: bloqueios por entregador, reincidentes (mesma infração 2 vezes ou mais), encerramentos e infrações leves.",
        tab([["Cidade"], ["Bloqueios", 1], ["Entregadores", 1], ["Por entregador", 1], ["Reincidentes", 1], ["Encerramentos", 1], ["Leves", 1]],
          d.cidades.map((x) => el("tr", {}, td(x.cidade), td(x.bloqueios, 1), td(x.entregadores, 1), td(n(x.por_entregador), 1), td(x.reincidentes, 1), td(x.encerramentos, 1), td(x.leves, 1))), "Nenhum bloqueio no período.")),
      card("Tempo de resposta da ativação", "Do envio do cadastro à primeira decisão (aprovar, reprovar ou encerrar), em horas (mediana): por quem decidiu e pelo dia em que o cadastro chegou.",
        tab([["Quem decidiu"], ["Decisões", 1], ["Aprovou", 1], ["Horas (mediana)", 1]],
          ra.por_pessoa.map((x) => el("tr", {}, td(x.pessoa), td(x.decisoes, 1), td(x.aprovou, 1), td(n(x.horas_mediana), 1))), "Nenhuma decisão no período."),
        ra.por_dia.length ? el("div", {}, el("h4", { class: "an-sub", text: "Horas até a 1ª decisão, pelo dia do envio" }),
          ...barras(ra.por_dia.map((x) => ({ rotulo: `${DIAS_LONGOS[x.dia]} (${x.enviados} enviados)`, qtd: Number(x.horas_mediana) || 0, extra: n(x.horas_mediana) + " h" })), "var(--warn)", "")) : null),
      card("Punições desfeitas", "Bloqueios liberados antes do prazo (ou encerramentos revertidos), por infração. Muita liberação numa infração pode indicar regra dura demais ou registro sem prova.",
        tab([["Infração"], ["Bloqueios", 1], ["Liberados antes", 1], ["%", 1], ["Horas até liberar (média)", 1]],
          d.liberacoes.map((x) => el("tr", {}, td(x.infracao), td(x.bloqueios, 1), td(x.liberados, 1), td(n(x.pct) + "%", 1), td(n(x.horas_media), 1))), "Nenhuma punição desfeita no período.")),
      D.mAtiv ? card("Ativação por cidade", "Todos os cadastros recebidos, por cidade (desde o início).",
        tab([["Cidade"], ["Recebidos", 1], ["Em andamento", 1], ["Aprovados", 1], ["Reprovações", 1], ["Encerrados", 1], ["Tempo até aprovação", 1]],
          D.mAtiv.por_cidade.map((c) => el("tr", {}, td(c.cidade), td(c.recebidos, 1), td(c.em_andamento, 1), td(c.aprovados, 1), td(c.reprovacoes, 1), td(c.encerrados, 1), td(horas(c.horas_ate_aprovacao), 1))),
          "Nenhum cadastro ainda.")) : null,
      card("Por pessoa", "O que cada pessoa fez. Ativação: desde o início; bloqueios: no período escolhido.",
        D.mAtiv ? el("h4", { class: "an-sub", text: "Ativação" }) : null,
        D.mAtiv ? tab([["Pessoa"], ["Acesso"], ["Enviados", 1], ["Envios por dia (14 dias)", 1], ["Aprovou", 1], ["Reprovou", 1], ["Encerrou", 1]],
          D.mAtiv.por_pessoa.map((p) => el("tr", {}, td(p.id === S.me.id ? `${p.nome} (você)` : p.nome), td(PAPEL[p.papel]), td(p.enviados, 1),
            td((p.enviados_14d / 14).toFixed(1).replace(".", ","), 1), td(p.aprovou, 1), td(p.reprovou, 1), td(p.encerrou, 1))), "Sem atividade.") : null,
        D.mBloq ? el("h4", { class: "an-sub", text: "Bloqueios" }) : null,
        D.mBloq ? tab([["Pessoa"], ["Bloqueios", 1], ["Leves", 1], ["Tratou", 1]],
          D.mBloq.por_pessoa.map((x) => el("tr", {}, td(x.nome === S.me.nome ? `${x.nome} (você)` : x.nome), td(x.registrou - x.leves, 1), td(x.leves, 1), td(x.tratou, 1))), "Sem atividade no período.") : null),
      card("Tratativas por responsável", `Tratativas criadas no período (sem as importadas da planilha). O prazo é de ${S.resumo?.prazo_tratativa_horas ?? 32} h.`,
        tab([["Responsável"], ["Total", 1], ["Concluídas", 1], ["Tempo médio (h)", 1], ["Fora do prazo", 1], ["Pendentes", 1], ["Atrasadas agora", 1]],
          d.tratativas_por_responsavel.map((x) => el("tr", {}, td(x.responsavel), td(x.total, 1), td(x.concluidas, 1), td(n(x.horas_media), 1), td(x.fora_do_prazo, 1), td(x.pendentes, 1),
            el("td", { class: "num" + (x.atrasadas_agora ? " err" : ""), text: x.atrasadas_agora }))), "Nenhuma tratativa no período.")),
      card("Da ativação ao bloqueio", "Dos entregadores aprovados em cada mês, quantos levaram um bloqueio em até 30, 60 e 90 dias depois da aprovação. Um mês só entra na conta de 60 ou 90 dias quando já passou esse tempo.",
        el("div", { class: "destaques" }, destaque(ab.aprovados, "aprovados pelo sistema"), destaque(ab.bloqueados, "bloqueados depois"),
          destaque(ab.aprovados ? n(pct(ab.bloqueados, ab.aprovados)) + "%" : null, "do total"), destaque(ab.dias_medios, "dias até o 1º bloqueio (média)")),
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
    ["Bloqueios", "Bloqueios registrados", (r) => r.bloqueios.registrados, "ruim"],
    ["Bloqueios", "Entregadores com registro (bloqueio ou leve)", (r) => r.bloqueios.entregadores],
    ["Bloqueios", "Reincidências (2ª ocorrência ou mais)", (r) => r.bloqueios.reincidencias, "ruim"],
    ["Bloqueios", "Encerramentos de parceria", (r) => r.bloqueios.encerramentos, "ruim"],
    ["Bloqueios", "Infrações leves", (r) => r.bloqueios.leves, "ruim"],
    ["Bloqueios", "Bloqueios gerados por leves", (r) => r.bloqueios.gerados_por_leves, "ruim"],
    ["Bloqueios", "Liberados antes do prazo", (r) => r.bloqueios.liberados_antes],
    ["Bloqueios", "Encerramentos revertidos", (r) => r.bloqueios.revertidos],
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
          r.por_pessoa.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Pessoa"], ["Bloqueios", 1], ["Leves", 1], ["Cadastros", 1], ["Decisões", 1], ["Tratativas", 1]],
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

  App.modulo({
    id: "analises", nome: "Análises",
    abas: [
      { id: "simples", nome: "Análises simples", secao: "v-an-simples" },
      { id: "complexas", nome: "Análises complexas", secao: "v-an-analises" },
      { id: "resumo", nome: "Resumo semanal", secao: "v-an-resumo" },
    ],
    padrao: () => "simples",
    carregar: (aba) => (aba === "resumo" ? carregarResumo() : carregarAnalises(aba === "complexas" ? "complexas" : "simples")),
    render: (aba) => (aba === "resumo" ? renderResumo() : aba === "complexas" ? renderComplexas() : renderSimples()),
  });
})();
