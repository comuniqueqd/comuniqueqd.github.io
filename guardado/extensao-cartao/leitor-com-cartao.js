// Lê SÓ o ID, o nome e a cidade do entregador nas telas do Quero Log (admin.querolog.io) e do Crisp
// (app.crisp.chat) e mostra um cartão com os botões do Comunique. Celular, e-mail, CPF, endereço e o
// resto da tela nunca são lidos (LGPD). 1.1: cada botão abre um formulário curto no próprio cartão;
// nada é gravado sem a pessoa conferir e confirmar (e "Abrir no Comunique" continua em todos).
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

  // ---------- cartão (shadow DOM: o estilo do site não mexe nele, e vice-versa) ----------
  const casa = document.createElement("div");
  casa.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const raiz = casa.attachShadow({ mode: "open" });
  const css = document.createElement("style");
  css.textContent = `
    *{box-sizing:border-box}
    .c{font:13px/1.4 Inter,"Segoe UI",system-ui,sans-serif;background:#FAF7F1;color:#14352B;border:1px solid #E5DED1;border-radius:14px;
       box-shadow:0 12px 32px rgb(20 53 43/.22);inline-size:300px;max-block-size:calc(100vh - 32px);overflow:auto}
    .t{position:sticky;top:0;display:flex;align-items:center;gap:8px;background:#14352B;color:#F4EFE6;padding:8px 10px;font-weight:800}
    .t img{inline-size:20px;block-size:20px}.t span{flex:1}
    .x{border:0;background:none;color:#F4EFE6;font-size:16px;cursor:pointer;line-height:1;padding:2px 4px}
    .d{padding:8px 10px 0;display:grid;gap:2px}.d b{font-weight:700}.m{color:#4B5B54;font-family:ui-monospace,Consolas,monospace;font-size:12px}
    .alerta{margin:6px 10px 0;padding:6px 8px;border-radius:10px;background:#FBEFD9;color:#8A5300;font-size:12px}
    .ok{margin:6px 10px 0;padding:6px 8px;border-radius:10px;background:#E3F1E9;color:#18774E;font-size:12px;font-weight:600}
    .erro{color:#B3261E;font-size:12px;margin:0}
    .b{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px 10px}
    button.a{border:1px solid #E5DED1;background:#fff;color:#14352B;border-radius:10px;padding:7px 6px;font:600 12px/1.2 inherit;cursor:pointer;text-align:left}
    button.a:hover{border-color:#18774E}
    button.p{border:0;background:#14352B;color:#F4EFE6;border-radius:10px;padding:8px 10px;font:700 13px/1.2 inherit;cursor:pointer}
    button.p:disabled{opacity:.6;cursor:wait}
    button.l{border:0;background:none;color:#18774E;font:600 12px/1.2 inherit;cursor:pointer;padding:4px 0;text-align:left}
    button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #18774E;outline-offset:2px}
    form{display:grid;gap:7px;padding:8px 10px 10px}
    label{display:grid;gap:2px;font-size:12px;color:#4B5B54;font-weight:600}
    label.linha{display:flex;align-items:center;gap:6px;font-weight:500;color:#14352B}
    input,select,textarea{font:13px/1.3 inherit;color:#14352B;background:#fff;border:1px solid #E5DED1;border-radius:8px;padding:6px 8px;inline-size:100%}
    input[type=checkbox],input[type=radio]{inline-size:auto;accent-color:#18774E}
    .g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
    .opc{display:flex;gap:10px;flex-wrap:wrap}
    .previa{background:#fff;border:1px solid #E5DED1;border-radius:10px;padding:6px 8px;font-size:12px}
    .acoes{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .fechado .corpo{display:none}`;
  const card = document.createElement("div"); card.className = "c";
  raiz.append(css, card);

  function el(tag, attrs = {}, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v; else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    n.append(...filhos.flat().filter((f) => f != null && f !== false));
    return n;
  }
  const enviar = (msg) => chrome.runtime.sendMessage(msg);
  async function rpc(fn, args) {
    const r = await enviar({ tipo: "rpc", fn, args });
    if (!r?.ok) { const e = new Error(r?.erro || "Não foi possível falar com o Comunique."); e.semSessao = r?.semSessao; throw e; }
    return r.dados;
  }
  const abrir = (hash) => enviar({ tipo: "abrir", hash });
  const qs = (d) => new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
  const norm = (t) => limpo(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cidadeComunique = (c) => limpo(c).toUpperCase().replace(/\s*[-/]\s*([A-Z]{2})$/, " - $1");
  const valor = (t) => { const v = String(t || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); return v === "" ? null : Number(v); };
  const brl = (n) => "R$ " + Number(n).toFixed(2).replace(".", ",");
  const horasTxt = (h) => h == null ? "encerramento de parceria" : h < 24 ? `${h} h` : `${h} h (${Math.round((h / 24) * 10) / 10} dia(s))`;

  let atual = null, chave = "", modo = "botoes", aviso = null, sucesso = null, regrasCache = null;

  // confere no Comunique se o ID já tem ficha com outro nome (precisa estar logado na extensão)
  async function conferirFicha(d) {
    aviso = null;
    try {
      const r = await rpc("busca_rapida", { p_q: d.id });
      const f = (r?.entregadores || []).find((x) => String(x.id_app).toLowerCase() === d.id.toLowerCase());
      if (f) {
        d.temFicha = true;
        if (d.nome && f.nome && norm(f.nome) !== norm(d.nome)) aviso = `No Comunique este ID está como “${f.nome}”. Confira antes de gravar.`;
      }
    } catch (e) { if (e.semSessao) aviso = "Entre na extensão (ícone do Comunique) para gravar daqui. Sem login, os botões abrem o Comunique."; }
    if (atual === d) desenhar();
  }

  // os quatro formulários curtos
  const TITULOS = { entregador: "Cadastrar entregador", cadastro: "Nova ativação", bloqueio: "Bloquear", adicional: "Adicional" };
  function campoBase(d, cidades) {
    const id = el("input", { value: d.id, maxlength: 40, spellcheck: "false", "aria-label": "ID do entregador" });
    const nome = el("input", { value: d.nome || "", maxlength: 120, "aria-label": "Nome do entregador" });
    const lista = el("datalist", { id: "cx-cidades" }, (cidades || []).map((c) => el("option", { value: c })));
    const cid = el("input", { value: cidadeComunique(d.cidade), list: "cx-cidades", maxlength: 80, placeholder: "CIDADE - UF", "aria-label": "Cidade" });
    return { id, nome, cid, nos: [el("label", {}, "ID", id), el("label", {}, "Nome", nome), el("label", {}, "Cidade", cid), lista] };
  }
  async function formulario(acao) {
    const d = atual;
    let regras = regrasCache;
    if (!regras && (acao === "bloqueio" || acao === "entregador" || acao === "cadastro")) {
      try { regras = regrasCache = await rpc("regras_bloqueio"); } catch (_) { regras = null; }
    }
    const cidades = (regras?.cidades || []).filter((c) => c.ativa).map((c) => c.nome);
    const b = campoBase(d, cidades);
    const erro = el("p", { class: "erro", role: "alert", hidden: true });
    const falhou = (m) => { erro.textContent = m; erro.hidden = false; };
    const botao = el("button", { class: "p", type: "submit", text: acao === "bloqueio" ? "Registrar bloqueio" : acao === "adicional" ? "Registrar adicional" : acao === "cadastro" ? "Enviar para ativação" : "Salvar ficha" });
    const extra = [];
    let gravar;
    const base = () => ({ id: b.id.value.replace(/[^A-Za-z0-9]/g, ""), nome: limpo(b.nome.value), cidade: cidadeComunique(b.cid.value) });

    if (acao === "entregador") {
      const com = el("textarea", { rows: 2, maxlength: 1500, placeholder: "Opcional" });
      extra.push(el("label", {}, "Comentário", com));
      gravar = async (v) => { await rpc("cadastrar_entregador", { p_id_app: v.id, p_nome: v.nome, p_cidade: v.cidade || null, p_comentario: limpo(com.value) || null }); return "Ficha criada no Comunique."; };
    } else if (acao === "cadastro") {
      const obs = el("textarea", { rows: 2, maxlength: 600, placeholder: "Opcional" });
      extra.push(el("label", {}, "Observação", obs));
      gravar = async (v) => {
        if (!/^.+ - [A-Z]{2}$/.test(v.cidade)) throw new Error("Use a cidade no formato CIDADE - UF.");
        const r = await rpc("enviar_cadastro", { p_id_app: v.id, p_cpf: null, p_cidade: v.cidade, p_observacao: limpo(obs.value) || null, p_nome: v.nome || null });
        if (!r?.id) throw new Error(r?.erro || "O cadastro não foi enviado.");
        return "Cadastro enviado para a ativação.";
      };
    } else if (acao === "bloqueio") {
      const infs = (regras?.infracoes || []).filter((i) => !i.leve && i.ativa);
      const sel = el("select", { "aria-label": "Infração" }, el("option", { value: "", text: infs.length ? "Escolha a infração" : "Entre na extensão para ver as infrações" }), infs.map((i) => el("option", { value: i.id, text: i.nome })));
      const previa = el("div", { class: "previa", hidden: true });
      const agr = el("input", { type: "checkbox" }), agrBox = el("label", { class: "linha", hidden: true }, agr, el("span"));
      const sol = el("div", { hidden: true });
      const obs = el("textarea", { rows: 2, maxlength: 600, placeholder: "Opcional: o que aconteceu, código do pedido…" });
      let pv = null;
      sel.addEventListener("change", async () => {
        pv = null; previa.hidden = true; agrBox.hidden = true; sol.hidden = true;
        if (!sel.value) return;
        try { pv = await rpc("previa_bloqueio", { p_id_app: base().id, p_infracao: Number(sel.value) }); }
        catch (e) { return falhou(e.message); }
        const o = pv.ocorrencia ? `${pv.ocorrencia}ª ocorrência · ` : "";
        previa.textContent = pv.encerramento || pv.horas == null ? `${o}encerramento de parceria` : `${o}aplicar ${horasTxt(pv.horas)}`;
        previa.hidden = false;
        if (pv.agravante?.texto) { agrBox.lastChild.textContent = "Agravante: " + pv.agravante.texto; agrBox.hidden = false; }
        if (pv.pendencia) {
          sol.replaceChildren(el("span", { class: "m", text: `${pv.pendencia}: já foi solucionado?` }),
            el("div", { class: "opc" }, el("label", { class: "linha" }, el("input", { type: "radio", name: "cx-sol", value: "sim" }), "Sim"),
              el("label", { class: "linha" }, el("input", { type: "radio", name: "cx-sol", value: "nao" }), "Não")));
          sol.hidden = false;
        }
      });
      extra.push(el("label", {}, "Infração", sel), previa, agrBox, sol, el("label", {}, "Observação", obs));
      gravar = async (v) => {
        if (!v.nome) throw new Error("Preencha o nome do entregador.");
        if (!cidades.includes(v.cidade)) throw new Error("Escolha uma cidade da lista do Comunique.");
        if (!sel.value) throw new Error("Escolha a infração.");
        const solV = raiz.querySelector('input[name="cx-sol"]:checked')?.value;
        if (pv?.pendencia && !solV) throw new Error("Diga se já foi solucionado.");
        const r = await rpc("registrar_bloqueio_agravante", { p_id_app: v.id, p_nome: v.nome, p_cidade: v.cidade, p_infracao: Number(sel.value),
          p_observacao: limpo(obs.value) || null, p_comentario: null, p_agravante: !!(agr.checked && pv?.agravante), p_solucionado: pv?.pendencia ? solV === "sim" : null });
        return r?.horas == null ? "Encerramento de parceria registrado." : `Bloqueio registrado: aplique ${horasTxt(r.horas)}.`;
      };
    } else if (acao === "adicional") {
      const ent = el("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Valor da entrega" });
      const ped = el("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Valor do pedido" });
      const comb = el("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Valor combinado (total)" });
      const conta = el("span", { class: "m" });
      const atualizar = () => { const e = valor(ent.value), c = valor(comb.value); conta.textContent = e != null && c != null && !Number.isNaN(e - c) ? `Adicional: ${brl(Math.max(c - e, 0))}` : ""; };
      [ent, comb].forEach((x) => x.addEventListener("input", atualizar));
      const radio = (nome, op) => el("div", { class: "opc" }, op.map(([v, t]) => el("label", { class: "linha" }, el("input", { type: "radio", name: nome, value: v }), t)));
      const motivo = el("select", { "aria-label": "Motivo" }, el("option", { value: "", text: "Escolha" }),
        ["Pedido grande", "Distância", "Chuva", "Horário de pico", "Sem entregador disponível", "Outro"].map((m) => el("option", { value: m, text: m })));
      const pedido = el("input", { maxlength: 60, placeholder: "Opcional", "aria-label": "Código do pedido" });
      const lancado = el("input", { type: "checkbox" });
      extra.push(el("div", { class: "g3" }, el("label", {}, "Entrega", ent), el("label", {}, "Pedido", ped), el("label", {}, "Combinado", comb)), conta,
        el("label", {}, "De onde veio o pedido", radio("cx-origem", [["qd", "QD"], ["outros", "Outros"]])),
        el("label", {}, "Pedido de mercado?", radio("cx-mercado", [["sim", "Sim"], ["nao", "Não"]])),
        el("label", {}, "Motivo", motivo), el("label", {}, "Código do pedido (sem os números)", pedido),
        el("label", { class: "linha" }, lancado, "Já lancei no sistema (o entregador vai receber)"));
      gravar = async (v) => {
        const e = valor(ent.value), p = valor(ped.value), c = valor(comb.value);
        const origem = raiz.querySelector('input[name="cx-origem"]:checked')?.value, mercado = raiz.querySelector('input[name="cx-mercado"]:checked')?.value;
        if ([e, p, c].some((x) => x == null || Number.isNaN(x))) throw new Error("Preencha os valores da entrega, do pedido e o combinado.");
        if (!origem) throw new Error("Escolha de onde veio o pedido (QD ou outros).");
        if (!mercado) throw new Error("Diga se o pedido é de mercado.");
        if (!motivo.value) throw new Error("Escolha o motivo do adicional.");
        const r = await rpc("registrar_adicional", { p_cidade: v.cidade || null, p_id_app: v.id, p_nome: v.nome || null, p_origem: origem, p_mercado: mercado === "sim",
          p_motivo: motivo.value, p_valor_entrega: e, p_valor_pedido: p, p_valor_combinado: c, p_lancado: lancado.checked,
          p_pedido: limpo(pedido.value) || null, p_observacao: null });
        return r?.lancado ? `Adicional de ${brl(r.valor)} registrado.` : `Adicional de ${brl(r.valor)} registrado. Ficou nos pendentes até ser lançado.`;
      };
    }

    const form = el("form", { novalidate: true }, b.nos, extra, erro,
      el("div", { class: "acoes" }, botao,
        el("button", { class: "l", type: "button", onclick: () => abrir(`#preencher/${acao}?${qs(base())}`) }, "Abrir no Comunique")));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault(); erro.hidden = true;
      const v = base();
      if (v.id.length < 4) return falhou("ID do entregador muito curto. Confira.");
      botao.disabled = true;
      try { sucesso = await gravar(v); modo = "botoes"; desenhar(); }
      catch (e) { falhou(e.semSessao ? "Entre na extensão (clique no ícone do Comunique) e tente de novo." : e.message); }
      finally { botao.disabled = false; }
    });
    return form;
  }

  async function desenhar() {
    const d = atual;
    if (!d) return;
    const min = el("button", { class: "x", type: "button", title: "Recolher", "aria-label": "Recolher o cartão do Comunique", text: card.classList.contains("fechado") ? "+" : "–",
      onclick: (e) => { card.classList.toggle("fechado"); e.currentTarget.textContent = card.classList.contains("fechado") ? "+" : "–"; } });
    const topo = el("div", { class: "t" }, el("img", { src: chrome.runtime.getURL("icones/simbolo.svg"), alt: "" }),
      el("span", { text: modo === "botoes" ? "Comunique" : TITULOS[modo] }),
      modo !== "botoes" ? el("button", { class: "x", type: "button", title: "Voltar", "aria-label": "Voltar aos botões", text: "←", onclick: () => { modo = "botoes"; desenhar(); } }) : null, min);
    const dados = el("div", { class: "d" }, el("b", { text: d.nome || "Nome não encontrado" }), el("span", { class: "m", text: [d.id, d.cidade].filter(Boolean).join(" · ") }));
    const corpo = el("div", { class: "corpo" });
    if (modo === "botoes") {
      // o append do navegador escreve "null" quando recebe um nulo: filtrar antes
      corpo.append(...[dados, aviso ? el("div", { class: "alerta", text: "⚠️ " + aviso }) : null, sucesso ? el("div", { class: "ok", text: "✓ " + sucesso }) : null,
        el("div", { class: "b" },
          [["entregador", d.temFicha ? "🪪 Já tem ficha" : "🪪 Cadastrar"], ["cadastro", "📝 Nova ativação"], ["bloqueio", "⛔ Bloquear"], ["adicional", "💰 Adicional"]].map(([acao, rot]) =>
            el("button", { class: "a", type: "button", disabled: acao === "entregador" && d.temFicha ? true : null,
              onclick: () => { sucesso = null; modo = acao; desenhar(); } }, rot)),
          el("button", { class: "a", type: "button", onclick: () => abrir("#ficha/" + encodeURIComponent(d.id)) }, "🔎 Ver ficha"))].filter(Boolean));
    } else {
      corpo.append(...[aviso ? el("div", { class: "alerta", text: "⚠️ " + aviso }) : null, await formulario(modo)].filter(Boolean));
    }
    card.replaceChildren(topo, corpo);
  }

  // as telas são de página única (o conteúdo muda sem recarregar): relê quando a tela muda
  function conferir() {
    let d = null;
    try { d = ler(); } catch (_) {}
    if (d) d = { id: limpo(d.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 40), nome: limpo(d.nome).slice(0, 120), cidade: limpo(d.cidade).slice(0, 80) };
    if (!d?.id || d.id.length < 4) { if (atual) { casa.remove(); atual = null; chave = ""; } return; }
    const k = JSON.stringify(d);
    if (k === chave) return;
    chave = k; atual = d; modo = "botoes"; aviso = null; sucesso = null;
    desenhar();
    if (!casa.isConnected) document.documentElement.append(casa);
    conferirFicha(d);
  }
  // o painel lateral pergunta o que esta tela tem (para dizer "não encontrei ID de entregador nesta tela")
  chrome.runtime.onMessage.addListener((msg, _s, responder) => {
    if (msg?.tipo === "tela") responder({ site: location.hostname, entregador: atual ? { id: atual.id, nome: atual.nome, cidade: atual.cidade } : null });
  });
  let espera = null;
  new MutationObserver((lista) => {
    if (lista.every((m) => casa.contains(m.target))) return;   // mudanças dentro do próprio cartão não contam
    clearTimeout(espera); espera = setTimeout(conferir, 600);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  conferir();
})();
