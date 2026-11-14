// 009u: ícones próprios do Comunique (no lugar dos emojis, que saíram de todas as telas).
// Desenho da casa, no traço do símbolo do Dino: grade de 24, linha de 1,75, pontas e cantos arredondados,
// formas geométricas simples. Cada ícone é uma lista de formas [tag, atributos]; tudo é montado com
// createElementNS (nunca innerHTML). Uso: App.ic("ajuda") ou el("button", { icone: "ajuda" }, "Pedir ajuda").
(() => {
  // o mesmo arquivo serve o site (App) e a extensão (extensao/icones.js é cópia; o teste confere)
  const App = window.App || (window.App = {});
  const NS = "http://www.w3.org/2000/svg";
  const p = (d) => ["path", { d }];
  const c = (cx, cy, r) => ["circle", { cx, cy, r }];
  const r = (x, y, w, h, rx = 2) => ["rect", { x, y, width: w, height: h, rx }];
  const ICONES = {
    fechar: [p("M6.5 6.5l11 11M17.5 6.5l-11 11")],
    sino: [p("M6 10.5a6 6 0 0 1 12 0v3.5l2 3H4l2-3z"), p("M10 20.5h4")],
    lua: [p("M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z")],
    sol: [c(12, 12, 4), p("M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4")],
    instalar: [p("M12 4v10M8 10.5l4 4 4-4"), p("M5 19h14")],
    ajuda: [c(12, 12, 8.5), c(12, 12, 3.5), p("M6 6l3.5 3.5M14.5 14.5L18 18M18 6l-3.5 3.5M9.5 14.5L6 18")],
    aviso: [p("M4 10v4h3l8 4V6l-8 4z"), p("M18.5 9.5a3.5 3.5 0 0 1 0 5"), p("M7 14l1.2 5h2.6l-1-4.2")],
    turno: [p("M4 8.5h14l-3.5-3.5"), p("M20 15.5H6l3.5 3.5")],
    juntos: [c(9, 8.5, 3), p("M3.5 19.5a5.5 5.5 0 0 1 11 0"), c(17, 9.5, 2.5), p("M16 14.3a4.5 4.5 0 0 1 4.5 5.2")],
    aguardando: [p("M7 3.5h10M7 20.5h10"), p("M8.5 3.5v3L12 12l-3.5 5.5v3M15.5 3.5v3L12 12l3.5 5.5v3")],
    tempo: [c(12, 12, 8.5), p("M12 7.5V12l3 2")],
    agradecer: [p("M12 3.8l2.4 5.2 5.6.7-4.2 3.9 1.1 5.6L12 16.4l-4.9 2.8 1.1-5.6L4 9.7l5.6-.7z")],
    comentario: [p("M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z")],
    ok: [c(12, 12, 8.5), p("M8.5 12.2l2.4 2.4 4.6-4.8")],
    ajustar: [p("M14.5 5.5l4 4L9 19H5v-4z"), p("M12.5 7.5l4 4")],
    sortear: [r(4, 4, 16, 16, 3), p("M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01")],
    placar: [p("M3 20.5h18"), p("M5 20.5v-6h4v6M10 20.5V9h4v11.5M15 20.5v-8h4v8")],
    recorrente: [p("M4.5 11a7.5 7.5 0 0 1 13-4.6L19 8"), p("M19 4v4h-4"), p("M19.5 13a7.5 7.5 0 0 1-13 4.6L5 16"), p("M5 20v-4h4")],
    olho: [p("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"), c(12, 12, 3)],
    cadeado: [r(5, 10.5, 14, 10), p("M8 10.5V8a4 4 0 0 1 8 0v2.5")],
    alerta: [p("M12 4l9 15.5H3z"), p("M12 10v4M12 16.8h.01")],
    ativacao: [p("M6 3.5h8l4 4v13H6z"), p("M14 3.5v4h4"), p("M9 14l2 2 4-4")],
    bloqueio: [c(12, 12, 8.5), p("M7.5 12h9")],
    entregador: [r(3.5, 6, 17, 12), c(9, 11, 2), p("M6.3 15.8a2.8 2.8 0 0 1 5.4 0"), p("M14.5 10h3.5M14.5 13.5h3.5")],
    parceiro: [p("M4 9.5l1.5-5h13l1.5 5"), p("M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"), p("M5.5 13v7.5h13V13"), p("M10 20.5V16h4v4.5")],
    calculadora: [r(5, 3, 14, 18), p("M8.5 7h7"), p("M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M8.5 18h.01M12 18h.01M15.5 14.5V18")],
    adicional: [r(3, 6, 18, 12), c(12, 12, 2.5), p("M6.5 9.5h.01M17.5 14.5h.01")],
    tarefa: [r(4, 4, 16, 16, 3), p("M12 8.5v7M8.5 12h7")],
    registros: [p("M9 6.5h11M9 12h11M9 17.5h11"), p("M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01")],
    noticias: [r(4, 4.5, 13, 15, 1.5), p("M17 8.5h2.5V17a2.5 2.5 0 0 1-2.5 2.5"), p("M7.5 8.5h6M7.5 12h6M7.5 15.5h4")],
    som: [p("M4 9.5v5h3.5L12 18V6L7.5 9.5z"), p("M15.5 9a4 4 0 0 1 0 6"), p("M18 6.5a7.5 7.5 0 0 1 0 11")],
    tocar: [p("M8 5.5v13l10.5-6.5z")],
    meta: [c(12, 12, 8.5), c(12, 12, 4.5), p("M12 12h.01")],
  };
  // ícone avulso; rotulo = texto para leitor de tela (sem rótulo, fica escondido: o texto ao lado já diz)
  function ic(nome, { rotulo, classe } = {}) {
    const formas = ICONES[nome];
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", "ic" + (classe ? " " + classe : ""));
    s.setAttribute("data-ic", nome);
    if (rotulo) { s.setAttribute("role", "img"); s.setAttribute("aria-label", rotulo); }
    else s.setAttribute("aria-hidden", "true");
    for (const [tag, at] of formas || []) {
      const f = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(at)) f.setAttribute(k, v);
      s.append(f);
    }
    return s;
  }
  // tipo de tarefa → ícone (o banco ainda guarda um emoji em tipos_tarefa.icone; a tela ignora)
  const TIPO = { procurar_entregador: "olho", contato_entregador: "comentario", pedido_problema: "alerta", pagamento_entregador: "adicional",
    fazer_contato: "comentario", criar_comunicado: "aviso", revisar_registro: "ajustar", ativar_entregadores: "entregador", ativar_parceiro: "parceiro", livre: "tarefa" };
  App.icTipo = (tipo) => ic(TIPO[tipo] || "tarefa");
  App.ic = ic;
  App.icones = Object.keys(ICONES);
  // ícones fixos do index.html: <span data-icone="sino"></span> vira o desenho
  document.querySelectorAll("[data-icone]").forEach((n) => n.replaceChildren(ic(n.dataset.icone)));
})();
