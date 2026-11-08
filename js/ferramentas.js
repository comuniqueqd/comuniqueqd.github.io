// Módulo "Ferramentas" (009b): funções do dia a dia.
// - Calculadora de bairro: cidade + bairro informado pelo cliente + bairro real → quanto falta pagar ao
//   entregador (ele recebe valor − taxa do log; ajuste = real − informado, nunca negativo) e registra o
//   ajuste no Financeiro (registrar_ajuste_bairro), com "já lancei no sistema?".
// - Tarifas: consulta dos bairros (todos) e edição (moderador da ativação, salvar_bairro).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, tabela, janela } = App.u;
  const S = App.S;
  const F = { dados: null, erro: null, cidade: "", tCidade: "" };
  const render = () => App.render();
  const brl = (v) => (v == null ? "—" : "R$ " + Number(v).toFixed(2).replace(".", ","));
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  App.brl = brl;

  const bairrosDa = (cidade, inativos = false) => (F.dados?.bairros || []).filter((b) => b.cidade === cidade && (inativos || b.ativo));
  // acha pelo nome ou apelido, sem acento e sem diferenciar maiúsculas
  function achar(cidade, txt) {
    const q = norm(txt);
    if (!q) return null;
    const lista = bairrosDa(cidade);
    return lista.find((b) => norm(b.nome) === q) || lista.find((b) => b.apelidos.some((a) => norm(a) === q)) || null;
  }

  // ---------- calculadora ----------
  const form = $("#fe-form"), erro = $("#fe-erro");
  const calc = () => {
    const c = $("#fe-cidade").value;
    const bi = achar(c, $("#fe-informado").value), br = achar(c, $("#fe-real").value);
    return { c, bi, br, dif: bi && br ? Math.round((br.recebe - bi.recebe) * 100) / 100 : null };
  };
  $("#fe-id").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "")));
  $("#fe-cidade").addEventListener("change", (e) => { F.cidade = e.target.value; $("#fe-informado").value = ""; $("#fe-real").value = ""; renderCalc(); });
  ["#fe-informado", "#fe-real"].forEach((s) => $(s).addEventListener("input", () => renderResultado()));
  form.addEventListener("input", () => { erro.hidden = true; });
  form.addEventListener("reset", () => { erro.hidden = true; setTimeout(() => { $("#fe-cidade").value = F.cidade; renderResultado(); $("#fe-informado").focus(); }); });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const { c, bi, br } = calc();
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (!bi || !br) return falha("Escolha os dois bairros da lista.");
    if ($("#fe-id").value.trim().length < 4) return falha("Digite o ID do entregador.");
    if (!$("#fe-origem").value) return falha("Escolha de onde veio o pedido (QD ou outros).");
    const btn = $("#fe-enviar");
    btn.disabled = true;
    try {
      const r = await rpc("registrar_ajuste_bairro", { p_cidade: c, p_informado: bi.nome, p_real: br.nome, p_id_app: $("#fe-id").value.trim(),
        p_nome: $("#fe-nome").value.trim() || null, p_origem: $("#fe-origem").value, p_lancado: $("#fe-lancado").checked,
        p_pedido: $("#fe-pedido").value.trim() || null, p_motivo: $("#fe-motivo").value || null });
      toast(r.lancado ? `Ajuste de ${brl(r.valor)} registrado.` : `Ajuste de ${brl(r.valor)} registrado. Ficou em Adicionais pendentes até ser lançado.`);
      form.reset();
      App.carregar();
    } catch (e) { falha(msgErro(e)); } finally { btn.disabled = false; }
  });

  function renderCalc() {
    const cidades = (F.dados?.cidades || []).filter((c) => c.bairros > 0);
    const sel = $("#fe-cidade");
    if (sel.options.length !== cidades.length + 1) {
      sel.replaceChildren(el("option", { value: "", text: cidades.length ? "Escolha a cidade" : "Nenhuma cidade com bairros cadastrados" }),
        ...cidades.map((c) => el("option", { value: c.nome, text: c.nome })));
    }
    if (!F.cidade && cidades.length === 1) F.cidade = cidades[0].nome;
    sel.value = F.cidade;
    $("#fe-km").hidden = !(F.dados?.cidades || []).some((c) => c.tarifa_tipo === "km");
    // sugestões: nomes e apelidos da cidade
    const dl = $("#fe-bairros"), lista = bairrosDa(F.cidade);
    if (dl.dataset.cidade !== F.cidade || dl.options.length !== lista.length) {
      dl.dataset.cidade = F.cidade;
      dl.replaceChildren(...lista.map((b) => el("option", { value: b.nome, label: `${brl(b.recebe)} para o entregador${b.apelidos.length ? " · também: " + b.apelidos.join(", ") : ""}` })));
    }
    renderResultado();
  }
  function renderResultado() {
    const box = $("#fe-resultado"), reg = $("#fe-registrar");
    if (!F.dados) { reg.hidden = true; return box.replaceChildren(carregandoEl()); }
    const { c, bi, br, dif } = calc();
    if (!c) { reg.hidden = true; return box.replaceChildren(); }
    const lado = (rot, b, txt) => el("div", { class: "fe-lado" + (b ? "" : " vazio") }, el("div", { class: "meta", text: rot }),
      b ? [el("strong", { text: b.nome }), el("div", { class: "meta", text: `Valor ${brl(b.valor)} − taxa do log ${brl(b.taxa_log)}` }),
           el("div", { class: "fe-recebe", text: `${brl(b.recebe)} para o entregador` })]
        : el("div", { class: "meta", text: txt ? "Bairro não encontrado nesta cidade" : "Escolha o bairro" }));
    const iguais = bi && br && bi.id === br.id;
    box.replaceChildren(el("div", { class: "fe-calc" },
      lado("Informado pelo cliente", bi, $("#fe-informado").value.trim()),
      el("div", { class: "fe-seta", "aria-hidden": "true", text: "→" }),
      lado("Onde a entrega terminou", br, $("#fe-real").value.trim())),
      dif == null ? null : el("div", { class: "fe-total" + (dif < 0 ? " negativo" : "") },
        el("span", { text: iguais ? "Os dois bairros são iguais: não há ajuste." : "Ajuste para o entregador" }),
        iguais ? null : el("strong", { text: brl(Math.max(dif, 0)) }),
        dif < 0 ? el("p", { class: "warn-msg", text: `O bairro real paga menos (${brl(dif)}). O ajuste fica zero; isso não deveria acontecer, confira os bairros.` }) : null));
    reg.hidden = !(bi && br) || iguais;
  }

  // ---------- tarifas ----------
  ["#fe-t-q", "#fe-t-inativos"].forEach((s) => $(s).addEventListener("input", () => renderTarifas()));
  $("#fe-t-cidade").addEventListener("change", (e) => { F.tCidade = e.target.value; renderTarifas(); });
  $("#fe-t-novo").addEventListener("click", () => editar(null));
  function renderTarifas() {
    const D = F.dados;
    $("#fe-t-novo").hidden = !D?.pode_editar;
    const t = $("#fe-t-tabela");
    if (!D) return t.replaceChildren(...tabela([["Bairro"]], [], F.erro || "Carregando…"));
    const cids = D.cidades.filter((c) => c.bairros > 0 || D.pode_editar);
    const sel = $("#fe-t-cidade");
    if (sel.options.length !== cids.length) sel.replaceChildren(...cids.map((c) => el("option", { value: c.nome, text: `${c.nome}${c.bairros ? ` (${c.bairros})` : ""}` })));
    if (!F.tCidade || !cids.some((c) => c.nome === F.tCidade)) F.tCidade = (cids.find((c) => c.bairros > 0) || cids[0])?.nome || "";
    sel.value = F.tCidade;
    const q = norm($("#fe-t-q").value);
    const lista = bairrosDa(F.tCidade, $("#fe-t-inativos").checked).filter((b) => !q || norm(b.nome).includes(q) || b.apelidos.some((a) => norm(a).includes(q)));
    t.replaceChildren(...tabela([["Bairro"], ["Valor", 1], ["Taxa do log", 1], ["Entregador recebe", 1], [""]],
      lista.map((b) => el("tr", { style: b.ativo ? null : "opacity:.6" },
        el("td", {}, b.nome + (b.ativo ? "" : " (desativado)"), b.apelidos.length ? el("div", { class: "meta", text: "Também: " + b.apelidos.join(", ") }) : null),
        el("td", { class: "num", text: brl(b.valor) }), el("td", { class: "num", text: brl(b.taxa_log) }),
        el("td", { class: "num" }, el("strong", { text: brl(b.recebe) })),
        el("td", {}, D.pode_editar ? el("button", { class: "btn quiet small", type: "button", onclick: () => editar(b) }, "Editar") : null))),
      F.tCidade ? "Nenhum bairro com esse filtro." : "Nenhuma cidade com bairros cadastrados."));
  }
  function editar(b) {
    const campo = (rot, v, extra = {}) => { const i = el("input", { value: v ?? "", ...extra }); return [el("label", {}, rot, i), i]; };
    const cidade = el("select", {}, ...(F.dados.cidades.map((c) => el("option", { value: c.nome, text: c.nome }))));
    cidade.value = b?.cidade || F.tCidade;
    const [lN, nome] = campo("Nome do bairro", b?.nome, { maxlength: 80 });
    const [lV, valor] = campo("Valor (R$)", b ? String(b.valor).replace(".", ",") : "", { inputmode: "decimal" });
    const [lT, taxa] = campo("Taxa do log (R$)", b ? String(b.taxa_log).replace(".", ",") : "", { inputmode: "decimal" });
    const [lA, apel] = campo("Outros nomes (apelidos), separados por vírgula", b?.apelidos.join(", "));
    const ativo = el("input", { type: "checkbox" }); ativo.checked = b ? b.ativo : true;
    const erroJ = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const n = (x) => (x.value.trim() === "" ? null : Number(x.value.replace(",", ".")));
    const d = janela(b ? "Editar bairro" : "Novo bairro",
      el("label", {}, "Cidade", cidade), lN, el("div", { class: "grid2" }, lV, lT), lA,
      el("label", { class: "check" }, ativo, " Ativo (aparece na calculadora)"), erroJ,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          e.currentTarget.disabled = true; erroJ.hidden = true;
          try {
            await rpc("salvar_bairro", { p_id: b?.id ?? null, p_cidade: cidade.value, p_nome: nome.value, p_valor: n(valor), p_taxa_log: n(taxa),
              p_apelidos: apel.value.split(",").map((x) => x.trim()).filter(Boolean), p_ativo: ativo.checked });
            d.close(); toast(b ? "Bairro atualizado." : "Bairro criado."); F.tCidade = cidade.value; App.carregar();
          } catch (err) { e.currentTarget.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
        } }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }

  // ---------- mensagens prontas (009c) ----------
  // marcadores: {nome} {infracao} {regra} {ocorrencia} {punicao} {termino} {agravante} {reincidencia} {cidade}
  //             {estabelecimento} {meu_nome} {leves_limite} {leves_janela} {leves_situacao}
  const M = { dados: null, erro: null, tipo: "", opcao: 1 };
  // 009c2: cada modelo tem tipo e opção (1, 2, 3); sem nome, o "movimento alto" vira a versão para a cidade
  const tipoDe = (m) => m.tipo || m.chave, opcaoDe = (m) => m.opcao || 1;
  const PARA_CIDADE = { engajamento_movimento: "engajamento_cidade" };
  const MARCADORES = "{nome} {infracao} {regra} {ocorrencia} {punicao} {termino} {agravante} {reincidencia} {cidade} {estabelecimento} {meu_nome} {leves_limite} {leves_janela} {leves_situacao}";
  const primeiroNome = (n) => { const p = (n || "").trim().split(/\s+/)[0] || ""; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ""; };
  const preencher = (texto, v) => texto.replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  async function carregarMensagens(forcar) { if (!M.dados || forcar) M.dados = await rpc("mensagens"); return M.dados; }
  async function copiar(texto, onde) {
    try { await navigator.clipboard.writeText(texto); toast("Mensagem copiada."); }
    catch (_) { onde?.select?.(); toast("Selecione o texto e copie (Ctrl+C)."); }
  }
  // janela com a mensagem pronta, editável, e o botão Copiar
  async function abrirMensagem(chave, vars, titulo) {
    let d;
    try { await carregarMensagens(); } catch (e) { return toast(msgErro(e)); }
    const mod = M.dados.modelos.find((m) => m.chave === chave);
    if (!mod) return toast("Modelo de mensagem não encontrado.");
    const v = { meu_nome: primeiroNome(S.me?.nome), leves_limite: M.dados.leves?.limite, leves_janela: M.dados.leves?.janela_dias, ...vars };
    const area = el("textarea", { rows: 12, class: "msg-texto" });
    area.value = preencher(mod.texto, v);
    d = App.u.janela(titulo || mod.titulo,
      el("p", { class: "meta", style: "margin:0", text: "Confira e ajuste se precisar. A mensagem não é enviada pelo app: copie e mande pelo canal de sempre." }),
      area,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: () => copiar(area.value, area) }, "Copiar mensagem"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Fechar")));
  }
  // dados de cada infração (explicação), para quem monta a mensagem
  App.mensagens = { carregar: carregarMensagens, abrir: abrirMensagem, primeiroNome, preencher,
    explicacao: (id) => M.dados?.infracoes.find((i) => i.id === id)?.explicacao || "" };

  $("#fe-msg-modelo").addEventListener("change", (e) => { M.tipo = e.target.value; M.opcao = 1; renderMensagens(true); });
  ["#fe-msg-nome", "#fe-msg-estab", "#fe-msg-cidade"].forEach((s) => $(s).addEventListener("input", () => renderMensagens(true)));
  $("#fe-msg-form").addEventListener("submit", (e) => e.preventDefault());
  $("#fe-msg-copiar").addEventListener("click", () => copiar($("#fe-msg-texto").value, $("#fe-msg-texto")));
  function renderMensagens(refazer = false) {
    const D = M.dados;
    if (!D) { $("#fe-msg-modelos").replaceChildren(carregandoEl()); return; }
    const livres = D.modelos.filter((m) => m.grupo !== "bloqueio");
    // um item por tipo no seletor (a versão "para a cidade" entra sozinha quando não há nome)
    const tipos = [...new Map(livres.filter((m) => m.grupo !== "cidade").map((m) => [tipoDe(m), m])).values()];
    const sel = $("#fe-msg-modelo");
    if (sel.options.length !== tipos.length) sel.replaceChildren(...tipos.map((m) => el("option", { value: tipoDe(m), text: m.titulo.replace(/\s*\(.*\)$/, "") })));
    if (!M.tipo || !tipos.some((m) => tipoDe(m) === M.tipo)) { M.tipo = tipos[0] ? tipoDe(tipos[0]) : ""; M.opcao = 1; refazer = true; }
    sel.value = M.tipo;
    const cs = $("#fe-msg-cidade"), cids = (F.dados?.cidades || []).map((c) => c.nome);
    if (cs.options.length !== cids.length + 1) { const a = cs.value; cs.replaceChildren(el("option", { value: "", text: "Escolha a cidade" }), ...cids.map((c) => el("option", { value: c, text: c }))); cs.value = a; }
    const nome = primeiroNome($("#fe-msg-nome").value);
    const paraCidade = !nome && PARA_CIDADE[M.tipo] && livres.some((m) => tipoDe(m) === PARA_CIDADE[M.tipo]);
    const tipoUsado = paraCidade ? PARA_CIDADE[M.tipo] : M.tipo;
    const opcoes = livres.filter((m) => tipoDe(m) === tipoUsado).sort((a, b) => opcaoDe(a) - opcaoDe(b));
    if (!opcoes.some((m) => opcaoDe(m) === M.opcao)) M.opcao = opcoes[0] ? opcaoDe(opcoes[0]) : 1;
    const mod = opcoes.find((m) => opcaoDe(m) === M.opcao);
    $("#fe-msg-opcoes").replaceChildren(...(opcoes.length > 1 ? [el("span", { class: "meta", text: "Texto:" }), ...opcoes.map((m) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(opcaoDe(m) === M.opcao), onclick: () => { M.opcao = opcaoDe(m); renderMensagens(true); } }, `Opção ${opcaoDe(m)}`))] : []));
    const dica = $("#fe-msg-dica");
    dica.hidden = !PARA_CIDADE[M.tipo];
    dica.textContent = paraCidade ? "Sem nome do entregador: a mensagem sai para os entregadores da cidade." : "Com o nome do entregador, a mensagem sai para ele. Deixe em branco para mandar para a cidade toda.";
    // campos: o nome aparece sempre que o tipo usa nome (mesmo na versão para a cidade, para poder preencher)
    const base = livres.find((m) => tipoDe(m) === M.tipo);
    document.querySelectorAll("[data-msg-campo]").forEach((x) => (x.hidden = !base || !(base.texto.includes("{" + x.dataset.msgCampo + "}") || mod?.texto.includes("{" + x.dataset.msgCampo + "}"))));
    if (refazer && mod) $("#fe-msg-texto").value = preencher(mod.texto, { nome: nome || "[nome]",
      estabelecimento: $("#fe-msg-estab").value.trim() || "[estabelecimento]", cidade: cs.value || "[cidade]", meu_nome: primeiroNome(S.me?.nome) });
    // lista dos modelos (moderador edita)
    $("#fe-msg-modelos").replaceChildren(el("ul", { class: "lista-modelos" }, D.modelos.map((m) => el("li", {},
      el("strong", { text: m.titulo }), el("span", { class: "meta", text: (opcaoDe(m) > 1 || D.modelos.some((x) => x !== m && tipoDe(x) === tipoDe(m)) ? ` · opção ${opcaoDe(m)}` : "") + (m.grupo === "bloqueio" ? " · sai pelo bloqueio" : "") }),
      D.pode_editar ? el("button", { class: "btn link", type: "button", onclick: () => editarModelo(m) }, "Editar") : null))));
    // explicação de cada regra
    $("#fe-msg-regras").replaceChildren(...tabela([["Infração"], ["O que diz a regra"], ["Agravante"], [""]],
      D.infracoes.filter((i) => !i.leve).map((i) => el("tr", { style: i.ativa ? null : "opacity:.6" },
        el("td", { text: i.nome }), el("td", { text: i.explicacao || "—" }),
        el("td", { text: i.agravante ? `${i.agravante} (${i.agravante_efeito === "encerra" ? "encerra a parceria" : "conta como a próxima ocorrência"})` : "—" }),
        el("td", {}, S.me?.papel_bloqueios === "moderador" ? el("button", { class: "btn quiet small", type: "button", onclick: () => editarRegra(i) }, "Editar") : null))),
      "Nenhuma infração."));
  }
  function editarModelo(m) {
    const area = el("textarea", { rows: 12 }); area.value = m.texto;
    const erroJ = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = App.u.janela("Editar: " + m.titulo,
      el("p", { class: "meta", style: "margin:0", text: "Marcadores: " + MARCADORES + ". Lembrete: nas mensagens, bloqueio temporário é \"restrição temporária\"." }),
      area, erroJ,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          e.currentTarget.disabled = true; erroJ.hidden = true;
          try { await rpc("salvar_modelo_mensagem", { p_chave: m.chave, p_texto: area.value }); d.close(); toast("Modelo salvo."); await carregarMensagens(true); render(); }
          catch (err) { e.currentTarget.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
        } }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  function editarRegra(i) {
    const area = el("textarea", { rows: 5, maxlength: 600 }); area.value = i.explicacao || "";
    const ag = el("input", { value: i.agravante || "", maxlength: 160 });
    const ef = el("select", {}, el("option", { value: "mais_uma", text: "Conta como a próxima ocorrência" }), el("option", { value: "encerra", text: "Encerra a parceria" }));
    ef.value = i.agravante_efeito || "mais_uma";
    const erroJ = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = App.u.janela(i.nome,
      el("label", {}, "O que diz a regra (vai para a mensagem ao entregador)", area),
      el("label", {}, "Agravante (deixe em branco se não houver)", ag), el("label", {}, "O que o agravante faz", ef), erroJ,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          e.currentTarget.disabled = true; erroJ.hidden = true;
          try { await rpc("salvar_explicacao_infracao", { p_infracao: i.id, p_explicacao: area.value, p_agravante: ag.value || null, p_agravante_efeito: ag.value ? ef.value : null });
                d.close(); toast("Regra salva."); await carregarMensagens(true); render(); }
          catch (err) { e.currentTarget.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
        } }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }

  // atalho para os pendentes em tudo o que é de adicional (a tela de pendentes é do Financeiro)
  App.atalhoPendentes = () => {
    const n = S.resumo?.financeiro_pendentes || 0;
    document.querySelectorAll("[data-fin-atalho]").forEach((box) => box.replaceChildren(...(n ? [el("a", { class: "fin-pend", href: "#financeiro/pendentes" },
      el("strong", { text: `${n} ${n === 1 ? "registro seu ainda não foi lançado" : "registros seus ainda não foram lançados"} no sistema` }), " · ver pendentes →")] : [])));
  };

  App.modulo({
    id: "ferramentas", nome: "Ferramentas",
    abas: [
      { id: "calculadora", nome: "Calculadora de bairro", secao: "v-fe-calc" },
      { id: "tarifas", nome: "Tarifas dos bairros", secao: "v-fe-tarifas" },
      { id: "mensagens", nome: "Mensagens prontas", secao: "v-fe-mensagens" },
    ],
    async carregar(aba) {
      try { F.dados = await rpc("tarifas_bairros"); if (aba === "mensagens") await carregarMensagens(true); F.erro = null; } catch (e) { F.erro = msgErro(e); throw e; }
    },
    render(aba) { App.atalhoPendentes(); if (aba === "tarifas") renderTarifas(); else if (aba === "mensagens") renderMensagens(); else renderCalc(); },
  });
})();
