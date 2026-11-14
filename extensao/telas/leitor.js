// Lê SÓ o ID, o nome e a cidade do entregador nas telas do Quero Log (admin.querolog.io) e do Crisp
// (app.crisp.chat) e mostra um cartão com os botões do Comunique. Celular, e-mail, CPF, endereço e o
// resto da tela nunca são lidos (LGPD). Quem usa os dados é o painel lateral da extensão: ele pergunta
// ("tela") e recebe { site, entregador: {id, nome, cidade} | null }. A página não é alterada.
// (O cartão com botões que aparecia no canto da página está guardado em guardado/extensao-cartao/.)
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
      // o nome está no caminho "Lista / Nome". A página tem outros "Lista" (o título do topo, o menu):
      // vale o primeiro que tem um nome logo depois (pulando a barra "/")
      const pareceNome = (t) => t && t.length <= 80 && /[A-Za-zÀ-ú]{2}/.test(t) && !/^lista$/i.test(t) && !/\d{3}/.test(t);
      let nome = "";
      for (const lista of document.querySelectorAll("body *")) {
        if (lista.childElementCount || limpo(lista.textContent) !== "Lista") continue;
        // só vale dentro do caminho de navegação: depois de uma barra "/" ou num bloco "breadcrumb"
        // (o menu lateral também tem "Lista", seguido de outros itens que não são nome)
        const noCaminho = !!lista.closest('[class*="breadcrumb" i], [aria-label*="breadcrumb" i], [aria-label*="caminho" i]');
        // os irmãos que vêm depois (subindo até 2 níveis): <a>Lista</a> <span>/</span> <span>Nome</span>
        for (let p = lista, i = 0; p && i < 3 && !nome; i++, p = p.parentElement) {
          let barra = noCaminho;
          for (let irm = p.nextSibling; irm && !nome; irm = irm.nextSibling) {
            if (irm.nodeType !== 1 && irm.nodeType !== 3) continue;   // elementos e textos soltos ("Lista / Nome")
            let t = limpo(irm.nodeType === 1 ? irm.innerText || irm.textContent : irm.textContent);
            if (!t) continue;
            if (t === "/" || t === "›" || t === ">") { barra = true; continue; }
            if (/^[/›>]\s*/.test(t)) { barra = true; t = t.replace(/^[/›>]\s*/, ""); }
            if (barra && pareceNome(t)) nome = t;
            break;
          }
        }
        if (nome) break;
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

  // o painel lateral pergunta o que esta tela tem; a leitura é feita na hora, a página não muda
  chrome.runtime.onMessage.addListener((msg, _s, responder) => {
    if (msg?.tipo !== "tela") return;
    let d = null;
    try { d = ler(); } catch (_) {}
    if (d) d = { id: limpo(d.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 40), nome: limpo(d.nome).slice(0, 120), cidade: limpo(d.cidade).slice(0, 80) };
    responder({ site: location.hostname, entregador: d?.id?.length >= 4 ? d : null });
  });
})();
