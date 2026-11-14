// Formulários curtos da extensão (painel lateral): bloqueio, ativação, adicional, cadastrar entregador,
// calculadora de bairro e pedido de ajuda. Vêm preenchidos com o que a página aberta tem (ID, nome, cidade);
// a pessoa confere, completa e confirma. Nada é gravado sem o clique no botão do formulário.
// Uso: ComuniqueForms.montar(acao, dados, { rpc, abrir, pronto }) devolve um <form>.
//   rpc(fn, args) → Promise com a resposta do banco; abrir(hash) abre o Comunique (opcional);
//   pronto(mensagem) é chamado depois de gravar.
(() => {
  const limpo = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  const EMOJI = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*[\u{1F3FB}-\u{1F3FF}]?/gu;
  const semEmoji = (t) => String(t).replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/, "");
  function el(tag, attrs = {}, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "icone") { if (window.App?.ic) n.append(window.App.ic(v)); continue; }
      if (k === "text") n.textContent = semEmoji(v); else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    n.append(...filhos.flat().filter((f) => f != null && f !== false).map((f) => (f.nodeType ? f : semEmoji(f))));
    return n;
  }
  const norm = (t) => limpo(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cidadeComunique = (c) => limpo(c).toUpperCase().replace(/\s*[-/,]\s*([A-Z]{2})$/, " - $1");
  const valor = (t) => { const v = String(t || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); return v === "" ? null : Number(v); };
  const brl = (n) => "R$ " + Number(n).toFixed(2).replace(".", ",");
  const horasTxt = (h) => h == null ? "encerramento de parceria" : h < 24 ? `${h} h` : `${h} h (${Math.round((h / 24) * 10) / 10} dia(s))`;
  let uid = 0;

  // bairro: nome ou apelido sem acento; senão um com uma letra de diferença (como o Comunique faz)
  function distancia(a, b) {
    if (a === b) return 0;
    let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const at = [i];
      for (let j = 1; j <= b.length; j++) at[j] = Math.min(at[j - 1] + 1, ant[j] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = at;
    }
    return ant[b.length];
  }
  const numeros = (t) => norm(t).split(/\W+/).filter((p) => /^\d+$/.test(p) || /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(p)).sort().join(" ");
  function acharBairro(lista, txt) {
    const q = norm(txt);
    if (!q) return null;
    const exato = lista.find((b) => norm(b.nome) === q) || lista.find((b) => (b.apelidos || []).some((a) => norm(a) === q));
    if (exato) return exato;
    if (q.length < 5) return null;
    const sem = (t) => norm(t).replace(/[^a-z0-9]/g, "");
    return lista.find((b) => [b.nome, ...(b.apelidos || [])].some((x) => numeros(x) === numeros(txt) && distancia(sem(x), sem(txt)) <= 1)) || null;
  }

  async function montar(acao, dados = {}, ctx) {
    const { rpc, abrir, pronto } = ctx;
    const n = ++uid, nome = (s) => `cx${n}-${s}`;
    const erro = el("p", { class: "erro", role: "alert", hidden: true });
    const falhou = (m) => { erro.textContent = m; erro.hidden = false; };
    const radio = (grupo, opcoes, marcado) => el("div", { class: "opc" }, opcoes.map(([v, t]) =>
      el("label", { class: "linha" }, el("input", { type: "radio", name: nome(grupo), value: v, checked: v === marcado ? true : null }), t)));
    const marcado = (form, grupo) => form.querySelector(`input[name="${nome(grupo)}"]:checked`)?.value;

    // listas do banco (regras: cidades e infrações; tarifas: bairros)
    let regras = null, tarifas = null;
    if (["bloqueio", "entregador", "cadastro"].includes(acao)) { try { regras = await rpc("regras_bloqueio"); } catch (_) {} }
    if (acao === "calculadora") { try { tarifas = await rpc("tarifas_bairros"); } catch (e) { falhou(e.message); } }
    const cidades = (regras?.cidades || []).filter((c) => c.ativa).map((c) => c.nome);

    // ID, nome e cidade (vindos da página), editáveis
    const id = el("input", { value: dados.id || "", maxlength: 40, spellcheck: "false", autocomplete: "off", placeholder: "ID no aplicativo de entregas", "aria-label": "ID do entregador" });
    const nomeIn = el("input", { value: dados.nome || "", maxlength: 120, autocomplete: "off", "aria-label": "Nome do entregador" });
    const listaCid = el("datalist", { id: nome("cidades") }, cidades.map((c) => el("option", { value: c })));
    const cid = el("input", { value: cidadeComunique(dados.cidade), list: nome("cidades"), maxlength: 80, placeholder: "CIDADE - UF", autocomplete: "off", "aria-label": "Cidade" });
    id.addEventListener("input", () => (id.value = id.value.replace(/[^A-Za-z0-9]/g, "")));
    const camposBase = [el("label", {}, "ID do entregador", id), el("label", {}, "Nome", nomeIn), el("label", {}, "Cidade", cid), listaCid];
    const base = () => ({ id: id.value.replace(/[^A-Za-z0-9]/g, ""), nome: limpo(nomeIn.value), cidade: cidadeComunique(cid.value) });

    const extra = [];
    let gravar, textoBotao = "Registrar", foco = null;

    if (acao === "entregador") {
      const com = el("textarea", { rows: 2, maxlength: 1500, placeholder: "Opcional" });
      extra.push(el("label", {}, "Comentário", com));
      textoBotao = "Salvar ficha";
      gravar = async (v) => {
        if (!v.nome) throw new Error("Preencha o nome do entregador.");
        await rpc("cadastrar_entregador", { p_id_app: v.id, p_nome: v.nome, p_cidade: cidades.includes(v.cidade) ? v.cidade : null, p_comentario: limpo(com.value) || null });
        return `Ficha de ${v.nome} criada no Comunique.`;
      };
    } else if (acao === "cadastro") {
      const obs = el("textarea", { rows: 2, maxlength: 600, placeholder: "Opcional" });
      extra.push(el("label", {}, "Observação", obs));
      textoBotao = "Enviar para ativação";
      gravar = async (v) => {
        if (!/^.+ - [A-Z]{2}$/.test(v.cidade)) throw new Error("Use a cidade no formato CIDADE - UF.");
        const r = await rpc("enviar_cadastro", { p_id_app: v.id, p_cpf: null, p_cidade: v.cidade, p_observacao: limpo(obs.value) || null, p_nome: v.nome || null });
        if (!r?.id) throw new Error(r?.erro || "O cadastro não foi enviado.");
        return "Cadastro enviado para a ativação.";
      };
    } else if (acao === "bloqueio") {
      const infs = (regras?.infracoes || []).filter((i) => !i.leve && i.ativa);
      const sel = el("select", { "aria-label": "Motivo do bloqueio" }, el("option", { value: "", text: infs.length ? "Escolha o motivo" : "Não foi possível carregar os motivos" }),
        infs.map((i) => el("option", { value: i.id, text: i.nome })));
      const previa = el("div", { class: "previa", hidden: true });
      const agr = el("input", { type: "checkbox" }), agrBox = el("label", { class: "linha", hidden: true }, agr, el("span"));
      const sol = el("div", { class: "campo", hidden: true });
      const obs = el("textarea", { rows: 2, maxlength: 600, placeholder: "Opcional: o que aconteceu, código do pedido…" });
      let pv = null;
      const verPrevia = async () => {
        pv = null; previa.hidden = true; agrBox.hidden = true; sol.hidden = true;
        if (!sel.value || base().id.length < 4) return;
        try { pv = await rpc("previa_bloqueio", { p_id_app: base().id, p_infracao: Number(sel.value) }); }
        catch (e) { return falhou(e.message); }
        const o = pv.ocorrencia ? `${pv.ocorrencia}ª ocorrência · ` : "";
        previa.textContent = pv.encerramento || pv.horas == null ? `${o}encerramento de parceria` : `${o}aplicar ${horasTxt(pv.horas)}`;
        previa.hidden = false;
        if (pv.agravante?.texto) { agrBox.lastChild.textContent = "Agravante: " + pv.agravante.texto; agrBox.hidden = false; }
        if (pv.pendencia) { sol.replaceChildren(el("span", { class: "rot", text: `${pv.pendencia}: já foi solucionado?` }), radio("sol", [["sim", "Sim"], ["nao", "Não"]])); sol.hidden = false; }
      };
      sel.addEventListener("change", verPrevia);
      id.addEventListener("change", verPrevia);
      extra.push(el("label", {}, "Motivo do bloqueio", sel), previa, agrBox, sol, el("label", {}, "Observação", obs));
      textoBotao = "Registrar bloqueio"; foco = sel;
      gravar = async (v, form) => {
        if (!v.nome) throw new Error("Preencha o nome do entregador.");
        if (!cidades.includes(v.cidade)) throw new Error("Escolha uma cidade da lista do Comunique.");
        if (!sel.value) throw new Error("Escolha o motivo do bloqueio.");
        const solV = marcado(form, "sol");
        if (pv?.pendencia && !solV) throw new Error("Diga se já foi solucionado.");
        const r = await rpc("registrar_bloqueio_agravante", { p_id_app: v.id, p_nome: v.nome, p_cidade: v.cidade, p_infracao: Number(sel.value),
          p_observacao: limpo(obs.value) || null, p_comentario: null, p_agravante: !!(agr.checked && pv?.agravante), p_solucionado: pv?.pendencia ? solV === "sim" : null });
        return r?.horas == null ? "Encerramento de parceria registrado." : `Bloqueio registrado: aplique ${horasTxt(r.horas)}.`;
      };
    } else if (acao === "adicional") {
      const ent = el("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Valor da entrega" });
      const ped = el("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Valor do pedido" });
      const comb = el("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Valor combinado (total)" });
      const conta = el("span", { class: "conta-valor" });
      const atualizar = () => { const e = valor(ent.value), c = valor(comb.value); conta.textContent = e != null && c != null && !Number.isNaN(c - e) ? `Adicional: ${brl(Math.max(c - e, 0))}` : ""; };
      [ent, comb].forEach((x) => x.addEventListener("input", atualizar));
      const motivo = el("select", { "aria-label": "Motivo" }, el("option", { value: "", text: "Escolha" }),
        ["Pedido grande", "Distância", "Chuva", "Horário de pico", "Sem entregador disponível", "Outro"].map((m) => el("option", { value: m, text: m })));
      const pedido = el("input", { maxlength: 60, placeholder: "Opcional", autocomplete: "off", "aria-label": "Código do pedido" });
      const lancado = el("input", { type: "checkbox" });
      extra.push(el("div", { class: "g3" }, el("label", {}, "Entrega", ent), el("label", {}, "Pedido", ped), el("label", {}, "Combinado", comb)), conta,
        el("div", { class: "campo" }, el("span", { class: "rot", text: "De onde veio o pedido" }), radio("origem", [["qd", "QD"], ["outros", "Outros"]])),
        el("div", { class: "campo" }, el("span", { class: "rot", text: "Pedido de mercado?" }), radio("mercado", [["sim", "Sim"], ["nao", "Não"]])),
        el("label", {}, "Motivo", motivo), el("label", {}, "Código do pedido (sem os números)", pedido),
        el("label", { class: "linha" }, lancado, "Já lancei no sistema (o entregador vai receber)"));
      textoBotao = "Registrar adicional"; foco = ent;
      gravar = async (v, form) => {
        const e = valor(ent.value), p = valor(ped.value), c = valor(comb.value), origem = marcado(form, "origem"), mercado = marcado(form, "mercado");
        if ([e, p, c].some((x) => x == null || Number.isNaN(x))) throw new Error("Preencha os valores da entrega, do pedido e o combinado.");
        if (!origem) throw new Error("Escolha de onde veio o pedido (QD ou outros).");
        if (!mercado) throw new Error("Diga se o pedido é de mercado.");
        if (!motivo.value) throw new Error("Escolha o motivo do adicional.");
        const r = await rpc("registrar_adicional", { p_cidade: v.cidade || null, p_id_app: v.id, p_nome: v.nome || null, p_origem: origem, p_mercado: mercado === "sim",
          p_motivo: motivo.value, p_valor_entrega: e, p_valor_pedido: p, p_valor_combinado: c, p_lancado: lancado.checked, p_pedido: limpo(pedido.value) || null, p_observacao: null });
        return r?.lancado ? `Adicional de ${brl(r.valor)} registrado.` : `Adicional de ${brl(r.valor)} registrado. Ficou nos pendentes até ser lançado.`;
      };
    } else if (acao === "calculadora") {
      const comBairros = (tarifas?.cidades || []).filter((c) => c.bairros > 0).map((c) => c.nome);
      const daPagina = cidadeComunique(dados.cidade);
      const selCid = el("select", { "aria-label": "Cidade" }, el("option", { value: "", text: "Escolha a cidade" }), comBairros.map((c) => el("option", { value: c, text: c, selected: c === daPagina ? true : null })));
      const listaB = el("datalist", { id: nome("bairros") });
      const inf = el("input", { list: nome("bairros"), autocomplete: "off", placeholder: "Digite para buscar", "aria-label": "Bairro informado pelo cliente" });
      const real = el("input", { list: nome("bairros"), autocomplete: "off", placeholder: "Digite para buscar", "aria-label": "Bairro onde a entrega terminou" });
      const resultado = el("div", { class: "previa", hidden: true });
      const pedido = el("input", { maxlength: 60, autocomplete: "off", "aria-label": "Código do pedido", placeholder: "Ex.: 15-8UM60B" });
      const lancado = el("input", { type: "checkbox" });
      const doCid = () => (tarifas?.bairros || []).filter((b) => b.cidade === selCid.value && b.ativo !== false);
      const calcular = () => {
        const bi = acharBairro(doCid(), inf.value), br = acharBairro(doCid(), real.value);
        resultado.hidden = !(bi && br) && !(inf.value && real.value);
        if (!bi || !br) { resultado.textContent = inf.value && real.value ? "Bairro não encontrado nesta cidade." : ""; return null; }
        const dif = Math.round(((Number(br.recebe) || 0) - (Number(bi.recebe) || 0)) * 100) / 100;
        resultado.textContent = bi.id === br.id ? "Os dois bairros são iguais: não há ajuste."
          : `${bi.nome} → ${br.nome}: ajuste de ${brl(Math.max(dif, 0))} para o entregador${dif < 0 ? " (o real paga menos; confira os bairros)" : ""}.`;
        return { bi, br, dif };
      };
      selCid.addEventListener("change", () => { listaB.replaceChildren(...doCid().map((b) => el("option", { value: b.nome }))); calcular(); });
      listaB.replaceChildren(...doCid().map((b) => el("option", { value: b.nome })));
      [inf, real].forEach((x) => x.addEventListener("input", calcular));
      // a calculadora mostra a cidade numa lista; o campo de cidade da página não aparece de novo
      camposBase.splice(2, 2);
      extra.push(el("label", {}, "Cidade", selCid), listaB, el("label", {}, "Bairro informado pelo cliente", inf), el("label", {}, "Bairro onde a entrega terminou", real), resultado,
        el("div", { class: "campo" }, el("span", { class: "rot", text: "De onde veio o pedido" }), radio("origem", [["qd", "QD"], ["outros", "Outros"]], "qd")),
        el("label", {}, "Código do pedido (sem os números)", pedido),
        el("label", { class: "linha" }, lancado, "Já lancei no sistema (o entregador vai receber)"));
      textoBotao = "Registrar ajuste"; foco = inf;
      gravar = async (v, form) => {
        const c = calcular();
        if (!selCid.value) throw new Error("Escolha a cidade.");
        if (!c) throw new Error("Escolha os dois bairros da lista.");
        if (c.bi.id === c.br.id) throw new Error("Os dois bairros são iguais: não há ajuste para registrar.");
        const r = await rpc("registrar_ajuste_bairro", { p_cidade: selCid.value, p_informado: c.bi.nome, p_real: c.br.nome, p_id_app: v.id, p_nome: v.nome || null,
          p_origem: marcado(form, "origem") || "qd", p_lancado: lancado.checked, p_pedido: limpo(pedido.value) || null, p_motivo: null });
        return r?.lancado ? `Ajuste de ${brl(r.valor)} registrado.` : `Ajuste de ${brl(r.valor)} registrado. Ficou nos pendentes até ser lançado.`;
      };
    } else if (acao === "ajuda") {
      const texto = el("textarea", { rows: 3, maxlength: 500, placeholder: "Ex.: fila no Crisp com 12 conversas esperando" });
      camposBase.length = 0;
      extra.push(el("p", { class: "meta", text: "Aparece na tela inicial de toda a equipe, com som, por 10 minutos ou até alguém aceitar." }),
        el("div", { class: "campo" }, el("span", { class: "rot", text: "Do que é a ajuda?" }),
          radio("cat", [["monitoramento", "Operação – Monitoramento"], ["suporte_crisp", "Operação – Suporte (Crisp)"], ["suporte_blip", "Operação – Suporte (Blip)"]], "monitoramento")),
        el("label", {}, "O que está acontecendo (opcional)", texto));
      textoBotao = "Pedir ajuda"; foco = texto;
      gravar = async (_v, form) => { await rpc("pedir_ajuda", { p_categoria: marcado(form, "cat"), p_texto: limpo(texto.value) || null }); return "Pedido de ajuda enviado para a equipe."; };
    }

    const botao = el("button", { class: "btn primario", type: "submit", text: textoBotao });
    const precisaId = !["ajuda"].includes(acao);
    const form = el("form", { class: "form-cx", novalidate: true, "data-acao": acao },
      precisaId && !dados.id ? el("p", { class: "alerta", text: "Não encontrei ID de entregador nesta tela: preencha os dados." }) : null,
      dados.aviso ? el("p", { class: "alerta", text: dados.aviso }) : null,
      camposBase, extra, erro,
      el("div", { class: "acoes" }, botao,
        abrir && acao !== "ajuda" && acao !== "calculadora" ? el("button", { class: "link", type: "button", onclick: () => {
          const q = new URLSearchParams(Object.entries(base()).filter(([, x]) => x)).toString();
          abrir(`#preencher/${acao}?${q}`);
        } }, "Ver no Comunique") : null));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault(); erro.hidden = true;
      const v = base();
      if (precisaId && v.id.length < 4) return falhou("Preencha o ID do entregador.");
      botao.disabled = true;
      try { pronto(await gravar(v, form)); }
      catch (e) { falhou(e.semSessao ? "Entre na extensão (clique no ícone do Comunique) e tente de novo." : e.message); }
      finally { botao.disabled = false; }
    });
    form.focar = () => (foco || (precisaId && !dados.id ? id : null) || form.querySelector("input, select, textarea"))?.focus();
    return form;
  }

  globalThis.ComuniqueForms = { montar, cidadeComunique };
})();
