// Módulo "Análises": números agregados para todos os papéis (supabase/005-analises-anexos.sql).
// Aba Análises: eficácia da punição, reincidência, dia × hora, bloqueados por cidade, leves,
// tratativas por responsável e da ativação ao bloqueio. Aba Resumo semanal: terça a segunda,
// com comparação entre semanas e download em CSV ou PDF.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, vazio, carregandoEl, rpc, msgErro, tabela, barras, baixarCSV } = App.u;
  const S = App.S;
  const A = { periodo: 90, cidade: "", dados: null, chave: "", cidades: null, erro: null,
              resumo: {}, semana: "", comparar: "anterior", semanas: null };
  const render = () => App.render();
  const n = (v) => (v == null ? "—" : String(v).replace(".", ","));
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const card = (titulo, nota, ...conteudo) => el("div", { class: "panel" }, el("h3", { text: titulo }), nota ? el("p", { class: "an-nota", text: nota }) : null, ...conteudo);
  const destaque = (v, rotulo) => el("div", {}, el("b", { text: n(v) }), el("span", { text: rotulo }));

  // ---------- análises ----------
  const chaveAnalises = () => `${A.periodo}|${A.cidade}`;
  async function carregarAnalises() {
    if (!A.cidades) A.cidades = await rpc("listar_cidades").catch(() => []);
    const chave = chaveAnalises();
    try {
      const d = await rpc("analises", { p_dias: A.periodo === "tudo" ? null : A.periodo, p_cidade: A.cidade || null });
      if (chave === chaveAnalises()) { A.dados = d; A.chave = chave; A.erro = null; }
    } catch (e) { A.erro = msgErro(e); }
  }
  const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  function mapaCalor(lista) {
    const max = Math.max(1, ...lista.map((x) => x.qtd));
    const mapa = new Map(lista.map((x) => [`${x.dia}-${x.hora}`, x.qtd]));
    const cel = [el("span")];
    for (let h = 0; h < 24; h++) cel.push(el("span", { class: "h", text: h % 3 === 0 ? String(h) : "" }));
    for (let d = 0; d < 7; d++) {
      cel.push(el("span", { text: DIAS[d] }));
      for (let h = 0; h < 24; h++) {
        const q = mapa.get(`${d}-${h}`) || 0;
        cel.push(el("span", { class: "c", title: `${DIAS[d]}, ${h}h: ${q} registro(s)`,
          style: q ? `background:color-mix(in srgb, var(--accent) ${Math.round(15 + (85 * q) / max)}%, transparent)` : null }));
      }
    }
    return el("div", { class: "calor", role: "img", "aria-label": "Registros por dia da semana e hora" }, cel);
  }
  function renderAnalises() {
    document.querySelectorAll("[data-an-periodo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.anPeriodo === String(A.periodo))));
    const sel = $("#an-cidade");
    if (A.cidades && sel.dataset.sig !== String(A.cidades.length)) {
      sel.dataset.sig = String(A.cidades.length);
      sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...A.cidades.map((c) => el("option", { value: c, text: c })));
      sel.value = A.cidade;
    }
    const box = $("#an-cards"), d = A.dados;
    if (A.erro && !d) return box.replaceChildren(el("p", { class: "err", text: A.erro }));
    if (!d || A.chave !== chaveAnalises()) return box.replaceChildren(carregandoEl());
    const periodo = A.periodo === "tudo" ? "desde o início" : `nos últimos ${A.periodo} dias`;
    $("#an-sub").textContent = `Números da operação ${periodo}${A.cidade ? " em " + A.cidade : ""}. Só totais: nenhum dado pessoal.`;

    const ef = d.eficacia, ri = d.reincidencia, lv = d.leves, ab = d.ativacao_bloqueio;
    const totalBloq = d.bloqueados_por_cidade.reduce((s, x) => s + x.agora, 0);
    box.replaceChildren(
      card("Eficácia da punição", "Depois de cada punição, quantos entregadores voltaram a ser bloqueados em até 30 dias. Quanto menor a porcentagem, mais a punição funcionou. Só entram bloqueios com 30 dias ou mais.",
        ef.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Punição"], ["Bloqueios", 1], ["Voltaram em 30 dias", 1], ["%", 1]],
          ef.map((x) => el("tr", {}, el("td", { text: x.punicao }), el("td", { class: "num", text: x.bloqueios }), el("td", { class: "num", text: x.reincidiram_30d }), el("td", { class: "num", text: n(x.pct) + "%" }))), "")))
          : el("p", { class: "meta", text: "Ainda não há bloqueios com 30 dias no período." })),
      card("Tempo até reincidir", "Intervalo entre um bloqueio e o seguinte do mesmo entregador.",
        el("div", { class: "destaques" }, destaque(ri.total, "reincidências no período"), destaque(ri.mediana_dias == null ? null : ri.mediana_dias, "dias (mediana)")),
        ...barras(ri.faixas.map((f) => ({ rotulo: f.faixa, qtd: f.qtd })), "var(--warn)", "Nenhuma reincidência no período.")),
      card("Quando a equipe registra", "Bloqueios por dia da semana e hora do registro (que é quando o problema foi visto). Mais escuro = mais registros. Sem os importados da planilha.",
        d.dia_hora.length ? mapaCalor(d.dia_hora) : el("p", { class: "meta", text: "Nenhum registro no período." })),
      card("Bloqueados agora, por cidade", "Quem está bloqueado neste momento, separando quem foi ativado pelo sistema de quem só existe pelos bloqueios.",
        el("div", { class: "destaques" }, destaque(totalBloq, "bloqueados agora")),
        d.bloqueados_por_cidade.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Cidade"], ["Agora", 1], ["Vieram da ativação", 1], ["Só pelos bloqueios", 1]],
          d.bloqueados_por_cidade.map((x) => el("tr", {}, el("td", { text: x.cidade }), el("td", { class: "num", text: x.agora }), el("td", { class: "num", text: x.da_ativacao }), el("td", { class: "num", text: x.so_bloqueios }))), "")))
          : el("p", { class: "meta", text: "Ninguém bloqueado agora." })),
      card("Conversão das infrações leves", "Quantos entregadores com infração leve chegaram ao limite e ganharam um bloqueio normal.",
        el("div", { class: "destaques" }, destaque(lv.total, "infrações leves"), destaque(lv.entregadores, "entregadores"),
          destaque(lv.atingiram_limite, "chegaram ao limite"), destaque(lv.entregadores ? n(pct(lv.atingiram_limite, lv.entregadores)) + "%" : null, "conversão")),
        lv.por_motivo.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela([["Motivo"], ["Leves", 1], ["Geraram bloqueio", 1]],
          lv.por_motivo.map((x) => el("tr", {}, el("td", { text: x.infracao }), el("td", { class: "num", text: x.qtd }), el("td", { class: "num", text: x.geraram }))), ""))) : null),
      card("Tratativas por responsável", `Tratativas criadas no período (sem as importadas da planilha). O prazo é de ${S.resumo?.prazo_tratativa_horas ?? 32} h.`,
        d.tratativas_por_responsavel.length ? el("div", { class: "tablewrap" }, el("table", {}, ...tabela(
          [["Responsável"], ["Total", 1], ["Concluídas", 1], ["Tempo médio (h)", 1], ["Fora do prazo", 1], ["Pendentes", 1], ["Atrasadas agora", 1]],
          d.tratativas_por_responsavel.map((x) => el("tr", {}, el("td", { text: x.responsavel }), el("td", { class: "num", text: x.total }), el("td", { class: "num", text: x.concluidas }),
            el("td", { class: "num", text: n(x.horas_media) }), el("td", { class: "num", text: x.fora_do_prazo }), el("td", { class: "num", text: x.pendentes }),
            el("td", { class: "num" + (x.atrasadas_agora ? " err" : ""), text: x.atrasadas_agora }))), "")))
          : el("p", { class: "meta", text: "Nenhuma tratativa no período." })),
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
        ab.meses.some((m) => m.maduro_90 < m.aprovados) ? el("p", { class: "an-nota", text: "* conta só os aprovados que já completaram o prazo; — = ninguém do mês completou o prazo ainda." }) : null));
  }
  document.querySelectorAll("[data-an-periodo]").forEach((b) => b.addEventListener("click", () => {
    A.periodo = b.dataset.anPeriodo === "tudo" ? "tudo" : Number(b.dataset.anPeriodo); render(); App.carregar();
  }));
  $("#an-cidade").addEventListener("change", (e) => { A.cidade = e.target.value; render(); App.carregar(); });

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
      { id: "analises", nome: "Análises", secao: "v-an-analises" },
      { id: "resumo", nome: "Resumo semanal", secao: "v-an-resumo" },
    ],
    carregar: (aba) => (aba === "resumo" ? carregarResumo() : carregarAnalises()),
    render: (aba) => (aba === "resumo" ? renderResumo() : renderAnalises()),
  });
})();
