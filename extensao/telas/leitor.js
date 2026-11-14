// Lê SÓ o ID, o nome e a cidade do entregador nas telas do Quero Log (admin.querolog.io) e do Crisp
// (app.crisp.chat) e mostra um cartão com os botões do Comunique. Celular, e-mail, CPF, endereço e o
// resto da tela nunca são lidos (LGPD). Nada é salvo aqui: o botão abre o formulário do Comunique
// já preenchido e a pessoa confere antes de salvar.
(() => {
  if (window.__comuniqueLeitor) return;
  window.__comuniqueLeitor = true;

  const limpo = (t) => String(t || "").replace(/\s+/g, " ").trim();
  // o texto que vem logo depois de um rótulo ("Id", "Franquia", "entregador_id", "cidade") na mesma linha da tabela
  function depoisDoRotulo(rotulo) {
    const alvo = rotulo.toLowerCase();
    const folhas = document.querySelectorAll("body :not(script):not(style)");
    for (const n of folhas) {
      if (n.childElementCount || limpo(n.textContent).toLowerCase() !== alvo) continue;
      // 1º: o elemento logo depois do rótulo (célula ao lado), subindo até 3 níveis
      for (let p = n, i = 0; p && i < 3; i++, p = p.parentElement) {
        const v = limpo(p.nextElementSibling?.innerText || p.nextElementSibling?.textContent);
        if (v) return v.split(/[\n\t]/).map(limpo).find(Boolean) || "";
      }
      // 2º: o texto da linha da tabela depois do rótulo
      let linha = n;
      for (let i = 0; i < 4 && linha.parentElement; i++) {
        linha = linha.parentElement;
        // rótulo e valor podem vir em linhas separadas, em células (tab) ou na mesma linha
        const partes = (linha.innerText || "").split(/[\n\t]/).map(limpo).filter(Boolean);
        const k = partes.findIndex((p) => p.toLowerCase() === alvo);
        if (k >= 0 && partes[k + 1]) return partes[k + 1];
        const junto = partes.find((p) => p.toLowerCase().startsWith(alvo + " "));
        if (junto) return limpo(junto.slice(alvo.length));
      }
    }
    return "";
  }

  const LEITORES = {
    // Quero Log: admin.querolog.io/entregadores/<id> → linha "Id", caminho "Lista / Nome", linha "Franquia"
    "admin.querolog.io": () => {
      const m = location.pathname.match(/\/entregadores\/([A-Za-z0-9]+)/);
      if (!m) return null;
      const id = depoisDoRotulo("Id") || m[1];
      let nome = "";
      const lista = [...document.querySelectorAll("body *")].find((n) => !n.childElementCount && limpo(n.textContent) === "Lista");
      for (let p = lista, i = 0; p && i < 4 && !nome; i++, p = p.parentElement) {
        const partes = (p.innerText || "").split(/\n|\//).map(limpo).filter(Boolean);
        const k = partes.indexOf("Lista");
        if (k >= 0 && partes[k + 1]) nome = partes[k + 1];
      }
      return { id, nome, cidade: depoisDoRotulo("Franquia") };
    },
    // Crisp: "Dados personalizados" → entregador_id e cidade; o nome fica no cabeçalho do contato
    "app.crisp.chat": () => {
      const id = depoisDoRotulo("entregador_id");
      if (!id) return null;
      // o botão "Ver Perfil de <primeiro nome>" diz por onde o nome começa; o nome completo é o texto que começa igual
      const ver = [...document.querySelectorAll("button, a")].find((b) => /^Ver Perfil de /i.test(limpo(b.textContent)));
      const primeiro = limpo(ver?.textContent).replace(/^Ver Perfil de /i, "");
      let nome = primeiro;
      if (primeiro) for (const n of document.querySelectorAll("body *")) {
        if (n.childElementCount || n.closest("button, a")) continue;
        const t = limpo(n.textContent);
        if (t.length > nome.length && t.length < 120 && t.toLowerCase().startsWith(primeiro.toLowerCase() + " ") && !t.includes("@")) nome = t;
      }
      return { id, nome: nome.replace(/(\.\.\.|…)$/, "").trim(), cidade: depoisDoRotulo("cidade") };
    },
  };
  const ler = LEITORES[location.hostname];
  if (!ler) return;

  // cartão num shadow DOM, para o estilo do site não mexer nele (e vice-versa)
  const casa = document.createElement("div");
  casa.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const raiz = casa.attachShadow({ mode: "closed" });
  const css = document.createElement("style");
  css.textContent = `
    .c{font:13px/1.4 Inter,"Segoe UI",system-ui,sans-serif;background:#FAF7F1;color:#14352B;border:1px solid #E5DED1;border-radius:14px;
       box-shadow:0 12px 32px rgb(20 53 43/.22);inline-size:280px;overflow:hidden}
    .t{display:flex;align-items:center;gap:8px;background:#14352B;color:#F4EFE6;padding:8px 10px;font-weight:800}
    .t img{inline-size:20px;block-size:20px}.t span{flex:1}
    .x{border:0;background:none;color:#F4EFE6;font-size:16px;cursor:pointer;line-height:1}
    .d{padding:8px 10px;display:grid;gap:2px}.d b{font-weight:700}.d .m{color:#4B5B54;font-family:ui-monospace,Consolas,monospace;font-size:12px}
    .b{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 10px 10px}
    button.a{border:1px solid #E5DED1;background:#fff;color:#14352B;border-radius:10px;padding:7px 6px;font:600 12px/1.2 inherit;cursor:pointer;text-align:left}
    button.a:hover{border-color:#18774E}button.a:focus-visible,.x:focus-visible{outline:2px solid #18774E;outline-offset:2px}
    .min{display:none}.fechado .d,.fechado .b{display:none}.fechado .min{display:inline}`;
  const card = document.createElement("div"); card.className = "c";
  raiz.append(css, card);

  const BOTOES = [["entregador", "🪪 Cadastrar"], ["cadastro", "📝 Nova ativação"], ["bloqueio", "⛔ Bloquear"], ["adicional", "💰 Adicional"]];
  let atual = null, chave = "";
  const abrir = (hash) => chrome.runtime.sendMessage({ tipo: "abrir", hash });
  const qs = (d) => new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();

  function desenhar(d) {
    card.replaceChildren();
    const topo = document.createElement("div"); topo.className = "t";
    const img = document.createElement("img"); img.src = chrome.runtime.getURL("icones/simbolo.svg"); img.alt = "";
    const tit = document.createElement("span"); tit.textContent = "Comunique";
    const min = document.createElement("button"); min.className = "x"; min.type = "button";
    min.textContent = "–"; min.title = "Recolher"; min.setAttribute("aria-label", "Recolher o cartão do Comunique");
    min.addEventListener("click", () => { card.classList.toggle("fechado"); min.textContent = card.classList.contains("fechado") ? "+" : "–"; });
    topo.append(img, tit, min);
    const dados = document.createElement("div"); dados.className = "d";
    const n = document.createElement("b"); n.textContent = d.nome || "Nome não encontrado";
    const m = document.createElement("span"); m.className = "m"; m.textContent = [d.id, d.cidade].filter(Boolean).join(" · ");
    dados.append(n, m);
    const bts = document.createElement("div"); bts.className = "b";
    for (const [acao, rot] of BOTOES) {
      const b = document.createElement("button"); b.className = "a"; b.type = "button"; b.textContent = rot;
      b.addEventListener("click", () => abrir(`#preencher/${acao}?${qs(d)}`));
      bts.append(b);
    }
    const ficha = document.createElement("button"); ficha.className = "a"; ficha.type = "button"; ficha.textContent = "🔎 Ver ficha";
    ficha.addEventListener("click", () => abrir("#ficha/" + encodeURIComponent(d.id)));
    bts.append(ficha);
    card.append(topo, dados, bts);
  }

  // as telas são de página única (o conteúdo muda sem recarregar): relê quando a tela muda
  function conferir() {
    let d = null;
    try { d = ler(); } catch (_) {}
    if (d) d = { id: limpo(d.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 40), nome: limpo(d.nome).slice(0, 120), cidade: limpo(d.cidade).slice(0, 80) };
    if (!d?.id || d.id.length < 4) { if (atual) { casa.remove(); atual = null; chave = ""; } return; }
    const k = JSON.stringify(d);
    if (k === chave) return;
    chave = k; atual = d;
    desenhar(d);
    if (!casa.isConnected) document.documentElement.append(casa);
  }
  let espera = null;
  new MutationObserver(() => { clearTimeout(espera); espera = setTimeout(conferir, 600); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  conferir();
})();
