// Sons dos avisos (009d): 4 níveis de urgência, tocados no navegador (WebAudio, sem arquivo de som).
//   4 = pedido de ajuda (repete enquanto houver um pedido aberto, por até 1 min)
//   3 = tratativa atrasada e previsão vencida
//   2 = o que é para você (decisões, tarefas), aviso geral e passagem de turno
//   1 = o resto (registros da cidade, comentários, financeiro, seguindo)
// "De olho nele" sobe um nível. Notificação do sistema (fora da aba) nos níveis 3 e 4, se a pessoa ligar.
// Preferências ficam no navegador (localStorage "comunique-som"), cada pessoa escolhe as suas.
(() => {
  "use strict";
  const App = window.App;
  const S = App.S;
  const CHAVE = "comunique-som";
  const PADRAO = { n1: true, n2: true, n3: true, n4: true, sistema: false };
  const NIVEIS = [[4, "Pedido de ajuda (alarme, repete por até 1 min)"], [3, "Tratativa atrasada e previsão vencida"],
    [2, "Para você, aviso geral e passagem de turno"], [1, "O resto (registros, comentários, financeiro)"]];

  function pref() {
    try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE) || "{}") }; } catch (_) { return { ...PADRAO }; }
  }
  function salvar(p) { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch (_) {} }

  // o navegador só deixa tocar som depois que a pessoa mexeu na página
  let ctx = null;
  function audio() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { ctx = new C(); } catch (_) { return null; } }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  addEventListener("pointerdown", () => audio(), { once: true, capture: true });
  addEventListener("keydown", () => audio(), { once: true, capture: true });

  // notas: [frequência, início (s), duração (s)]
  const TONS = {
    1: { onda: "sine", vol: 0.06, notas: [[880, 0, 0.12]] },
    2: { onda: "sine", vol: 0.10, notas: [[660, 0, 0.16], [880, 0.18, 0.22]] },
    3: { onda: "triangle", vol: 0.14, notas: [[587, 0, 0.14], [740, 0.16, 0.14], [988, 0.32, 0.26]] },
    4: { onda: "square", vol: 0.08, notas: [[988, 0, 0.16], [740, 0.2, 0.16], [988, 0.4, 0.16], [740, 0.6, 0.16], [988, 0.8, 0.3]] },
  };
  function tocar(nivel, forcar = false) {
    const p = pref();
    if (!forcar && !p["n" + nivel]) return false;
    const c = audio(), t = TONS[nivel];
    if (!c || !t) return false;
    const agora = c.currentTime + 0.02;
    for (const [f, ini, dur] of t.notas) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = t.onda; o.frequency.value = f;
      g.gain.setValueAtTime(0, agora + ini);
      g.gain.linearRampToValueAtTime(t.vol, agora + ini + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, agora + ini + dur);
      o.connect(g).connect(c.destination);
      o.start(agora + ini); o.stop(agora + ini + dur + 0.05);
    }
    App.som.ultimo = { nivel, em: Date.now() };
    return true;
  }

  function nivelDe(n) {
    let v;
    if (n.categoria === "ajuda") v = 4;
    else if (!n.categoria && /atrasada|passou a previs/i.test(n.texto || "")) v = 3;
    else if (!n.categoria || n.categoria === "aviso_geral" || n.categoria === "turno") v = 2;
    else v = 1;
    if (n.motivo === "de_olho") v = Math.min(4, v + 1);
    return v;
  }

  function notificacaoSistema(n, nivel) {
    const p = pref();
    if (!p.sistema || nivel < 3 || !("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    try {
      const x = new Notification(nivel === 4 ? "Comunique: pedido de ajuda" : "Comunique", { body: n.texto || "", tag: "comunique-" + (n.id || Date.now()) });
      x.onclick = () => { window.focus(); if (n.link) location.hash = n.link.replace(/^#/, ""); x.close(); };
    } catch (_) {}
  }

  // aviso novo chegando pelo tempo real (linha nova de notificacoes)
  let ultimoSom = 0;
  function aviso(n) {
    if (!n) return;
    const nivel = nivelDe(n);
    notificacaoSistema(n, nivel);
    // muitos avisos juntos (ex.: uma importação) = um som só; o nível mais alto passa na frente
    if (Date.now() - ultimoSom < 3000 && nivel < 4) return;
    if (tocar(nivel)) ultimoSom = Date.now();
    if (nivel === 4) vigiarAjuda();
  }

  // pedido de ajuda aberto que eu posso pegar (também serve quando o tempo real falha: o tique traz a lista)
  const ajudaAberta = (a) => a.tipo === "ajuda" && !a.meu && !a.aceito_por_nome && !a.expirado &&
    (!a.expira_em || new Date(a.expira_em) > Date.now());
  const vistos = new Set();
  let repetir = null, repetirAte = 0;
  function vigiarAjuda() {
    repetirAte = Math.max(repetirAte, Date.now() + 60000);
    if (repetir) return;
    repetir = setInterval(() => {
      const abertas = (S.resumo?.avisos_rapidos || []).filter(ajudaAberta);
      if (!abertas.length || Date.now() > repetirAte) { clearInterval(repetir); repetir = null; return; }
      tocar(4);
    }, 20000);
  }
  function conferir() {
    if (!S.resumo) return;
    const abertas = (S.resumo?.avisos_rapidos || []).filter(ajudaAberta);
    const novas = abertas.filter((a) => !vistos.has(a.id + "|" + a.expira_em));
    abertas.forEach((a) => vistos.add(a.id + "|" + a.expira_em));
    if (!novas.length || !conferir.pronto) { conferir.pronto = true; return; }   // a primeira carga não toca
    if (!(App.som.ultimo?.nivel === 4 && Date.now() - App.som.ultimo.em < 20000)) tocar(4);
    notificacaoSistema({ texto: `${novas[0].criado_por_nome} pediu ajuda: ${novas[0].titulo}`, link: "#inicio", id: "ajuda-" + novas[0].id }, 4);
    vigiarAjuda();
  }
  function parar() { clearInterval(repetir); repetir = null; repetirAte = 0; }

  // painel das preferências (tela de Avisos)
  function painel() {
    const { el } = App.u;
    const p = pref();
    const caixa = (k, texto, extra) => {
      const cb = el("input", { type: "checkbox", switch: true, role: "switch", "data-som": k }); cb.checked = !!p[k];  // 009l: interruptor
      cb.addEventListener("change", async () => {
        const q = pref(); q[k] = cb.checked;
        if (k === "sistema" && cb.checked && "Notification" in window && Notification.permission !== "granted") {
          const r = await Notification.requestPermission().catch(() => "denied");
          if (r !== "granted") { cb.checked = false; q.sistema = false; App.u.toast("O navegador não deixou mostrar notificações. Libere nas configurações do site."); }
        }
        salvar(q);
      });
      return el("label", { class: "marcar" }, cb, texto, extra || null);
    };
    return el("div", {}, el("h4", { text: "Sons neste navegador" }),
      ...NIVEIS.map(([n, t]) => caixa("n" + n, t, el("button", { class: "btn link", type: "button", "aria-label": "Ouvir o som do nível " + n,
        onclick: () => tocar(n, true) }, "▶ ouvir"))),
      "Notification" in window ? caixa("sistema", "Notificação do sistema quando a aba está escondida (ajuda, atraso e previsão)") : null,
      el("p", { class: "meta", text: "Vale só para este navegador. O som toca com o Comunique aberto (pode ser em outra aba)." }));
  }

  // janela de teste (botão na tela Equipe): ouvir cada nível e testar a notificação do sistema
  function janelaTeste() {
    const { el, toast } = App.u;
    const p = pref();
    const perm = () => (!("Notification" in window) ? "este navegador não tem notificações" : Notification.permission === "granted" ? "permitida"
      : Notification.permission === "denied" ? "bloqueada (libere nas configurações do site)" : "ainda não pedida");
    const status = el("p", { class: "meta", id: "teste-som-status" });
    const atualizar = () => { status.textContent = `Som: ${audio()?.state === "running" ? "pronto" : "toque em qualquer botão para liberar"} · Notificação do sistema: ${perm()} · ligada nas preferências: ${pref().sistema ? "sim" : "não"}`; };
    const notificar = async (atraso) => {
      if (!("Notification" in window)) return toast("Este navegador não mostra notificações do sistema.");
      if (Notification.permission === "default") await Notification.requestPermission().catch(() => {});
      atualizar();
      if (Notification.permission !== "granted") return toast("O navegador não deixou mostrar notificações. Libere nas configurações do site.");
      const mostrar = () => { tocar(3, true); try { new Notification("Comunique: teste", { body: "Se você está vendo isto, as notificações do sistema funcionam.", tag: "comunique-teste" }); } catch (_) { toast("Não consegui mostrar a notificação."); } };
      if (atraso) { toast("Troque de aba ou minimize: a notificação chega em 5 segundos."); setTimeout(mostrar, 5000); } else mostrar();
    };
    const d = App.u.janela("Testar avisos e sons",
      el("p", { class: "meta", style: "margin-top:0", text: "Só neste navegador: nada é enviado para a equipe." }),
      el("ul", { class: "teste-sons" }, NIVEIS.map(([n, t]) => el("li", {},
        el("button", { class: "btn small", type: "button", "data-teste-nivel": n, onclick: () => { tocar(n, true); atualizar(); } }, `▶ Nível ${n}`),
        el("span", { text: t }), el("span", { class: "meta", text: p["n" + n] ? "ligado" : "desligado nas suas preferências" })))),
      el("div", { class: "actions" },
        el("button", { class: "btn small", type: "button", onclick: () => notificar(false) }, "Notificação do sistema agora"),
        el("button", { class: "btn small", type: "button", onclick: () => notificar(true) }, "Notificação em 5 s (troque de aba)"),
        el("button", { class: "btn small", type: "button", onclick: () => toast("Este é o aviso na tela (o toast).") }, "Aviso na tela")),
      status,
      el("p", { class: "meta" }, "Para ligar ou desligar cada som e a notificação do sistema: ", el("a", { href: "#avisos/para-mim", onclick: () => d.close() }, "Atividades → Avisos"), "."));
    d.id = "janela-teste-som";
    atualizar();
  }
  document.querySelectorAll("[data-teste-som]").forEach((b) => b.addEventListener("click", janelaTeste));  // Equipe e Regras de equipe (todos)

  App.som = { tocar, aviso, conferir, parar, painel, nivelDe, pref, janelaTeste, ultimo: null };
})();
