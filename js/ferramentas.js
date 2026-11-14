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
  // 009p: nomes parecidos (as mesmas regras de grau_bairro() no banco): "igual" (só acento/maiúscula/espaço),
  // "quase" (uma letra, nomes com 5+ letras), "parecido" (duas letras, ou um nome dentro do outro sem os prefixos).
  // Números e algarismos romanos diferentes nunca são parecidos ("Conjunto 1" × "Conjunto 2").
  const normB = (t) => norm(t).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const numerosB = (t) => normB(t).split(" ").filter((p) => /^\d+$/.test(p) || /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/.test(p)).sort().join(" ");
  const nucleoB = (t) => (" " + normB(t) + " ").replace(/ (BAIRRO|POVOADO|POV|CONJUNTO|CONJ|RESIDENCIAL|RES|LOTEAMENTO|LOT|PARQUE|JARDIM|JD|VILA|SITIO|FAZENDA|CONDOMINIO|COND|DE|DA|DO|DAS|DOS)(?= )/g, "").trim();
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
  function grauBairro(a, b) {
    const na = normB(a), nb = normB(b);
    if (!na || !nb) return null;
    if (na === nb) return "igual";
    if (numerosB(a) !== numerosB(b)) return null;
    const m = Math.min(na.length, nb.length);
    if (Math.abs(na.length - nb.length) <= 2) {
      const d = distancia(na.replace(/ /g, ""), nb.replace(/ /g, ""));
      if (d === 0) return "igual";
      if (d === 1 && m >= 5) return "quase";
      if (d === 2 && m >= 7) return "parecido";
    }
    const ca = nucleoB(a), cb = nucleoB(b);
    if (ca.length >= 4 && cb.length >= 4 && (ca === cb || (Math.min(ca.length, cb.length) >= 5 && (` ${ca} `.includes(` ${cb} `) || ` ${cb} `.includes(` ${ca} `))))) return "parecido";
    return null;
  }
  // acha pelo nome ou apelido, sem acento e sem diferenciar maiúsculas; se não achar, um praticamente igual
  // (um erro de digitação, como "Aldemar" para ADEMAR) e marca o que a pessoa digitou
  function achar(cidade, txt) {
    const q = norm(txt);
    if (!q) return null;
    const lista = bairrosDa(cidade);
    const exato = lista.find((b) => norm(b.nome) === q) || lista.find((b) => b.apelidos.some((a) => norm(a) === q));
    if (exato) return exato;
    if (q.length < 4) return null;
    const perto = lista.find((b) => [b.nome, ...b.apelidos].some((x) => ["igual", "quase"].includes(grauBairro(txt, x))));
    return perto ? { ...perto, digitado: txt.trim() } : null;
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
      toast(r.lancado ? `Ajuste de ${brl(r.valor)} registrado.` : `Ajuste de ${brl(r.valor)} registrado. Ficou nos pendentes (em Lançamentos) até ser lançado.`);
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
      b ? [el("strong", { text: b.nome }), b.digitado ? el("div", { class: "meta entendido", text: `Você digitou “${b.digitado}”: é o mesmo bairro.` }) : null,
           el("div", { class: "meta", text: `Valor ${brl(b.valor)} − taxa do log ${brl(b.taxa_log)}` }),
           el("div", { class: "fe-recebe", text: `${brl(b.recebe)} para o entregador` })]
        : el("div", { class: "meta", text: txt ? "Bairro não encontrado nesta cidade" : "Escolha o bairro" }));
    const iguais = bi && br && bi.id === br.id;
    // revisão 009: o replaceChildren do navegador escreve "null" quando recebe um nulo (o el() pula, ele não): filtrar antes
    box.replaceChildren(...[el("div", { class: "fe-calc" },
      lado("Informado pelo cliente", bi, $("#fe-informado").value.trim()),
      el("div", { class: "fe-seta", "aria-hidden": "true", text: "→" }),
      lado("Onde a entrega terminou", br, $("#fe-real").value.trim())),
      dif == null ? null : el("div", { class: "fe-total" + (dif < 0 ? " negativo" : "") },
        el("span", { text: iguais ? "Os dois bairros são iguais: não há ajuste." : "Ajuste para o entregador" }),
        iguais ? null : el("strong", { text: brl(Math.max(dif, 0)) }),
        dif < 0 ? el("p", { class: "warn-msg", text: `O bairro real paga menos (${brl(dif)}). O ajuste fica zero; isso não deveria acontecer, confira os bairros.` }) : null)].filter(Boolean));
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
  // 009p: bairros já cadastrados com nome parecido: juntar (fica o valor do escolhido) ou marcar que são diferentes
  function renderParecidos() {
    const box = $("#fe-parecidos"), l = F.parecidos || [];
    App.contador("c-fe-parecidos", l.length);
    if (!l.length) return box.replaceChildren();
    const acao = async (bt, fn, args, msg) => { bt.disabled = true; try { await rpc(fn, args); toast(msg); App.carregar(); } catch (e) { bt.disabled = false; toast(msgErro(e)); } };
    const lado = (x) => el("span", {}, el("b", { text: x.nome }), el("span", { class: "meta", text: ` ${brl(x.recebe)} para o entregador` }));
    box.replaceChildren(el("div", { class: "parecidos" },
      el("h4", { text: `Bairros com nome parecido (${l.length})` }),
      el("p", { class: "meta", text: "Podem ser o mesmo bairro escrito de dois jeitos. Juntar deixa um nome só, com o valor do bairro escolhido; o outro nome continua funcionando como apelido." }),
      el("ul", { class: "lista-parecidos" }, l.map((p) => el("li", {},
        el("div", { class: "par" }, lado(p.a), el("span", { class: "meta", text: " × " }), lado(p.b), el("span", { class: "tag", text: p.cidade })),
        el("div", { class: "actions" },
          el("button", { class: "btn small", type: "button", onclick: (e) => acao(e.currentTarget, "juntar_bairros", { p_manter: p.a.id, p_juntar: p.b.id }, `Juntado: ficou ${p.a.nome}, com o valor dele.`) }, `Juntar em ${p.a.nome}`),
          el("button", { class: "btn small", type: "button", onclick: (e) => acao(e.currentTarget, "juntar_bairros", { p_manter: p.b.id, p_juntar: p.a.id }, `Juntado: ficou ${p.b.nome}, com o valor dele.`) }, `Juntar em ${p.b.nome}`),
          el("button", { class: "btn link", type: "button", onclick: (e) => acao(e.currentTarget, "bairros_sao_diferentes", { p_a: p.a.id, p_b: p.b.id }, "Certo: são bairros diferentes.") }, "São diferentes")))))));
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
          const bt = e.currentTarget; bt.disabled = true; erroJ.hidden = true;
          await salvar(bt);
        } }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    // 009p: o banco confere se já existe um bairro com nome parecido na cidade. Praticamente igual = junta
    // sozinho (o nome novo vira outro nome dele, com o valor dele); parecido = pergunta aqui antes.
    const conferir = el("div", { class: "pergunta-bairro", hidden: true });
    d.querySelector(".actions").before(conferir);
    async function salvar(bt, decisao, com) {
      try {
        const r = await rpc("salvar_bairro", { p_id: b?.id ?? null, p_cidade: cidade.value, p_nome: nome.value, p_valor: n(valor), p_taxa_log: n(taxa),
          p_apelidos: apel.value.split(",").map((x) => x.trim()).filter(Boolean), p_ativo: ativo.checked,
          ...(decisao ? { p_decisao: decisao, p_juntar_com: com } : {}) });
        if (r?.precisa_confirmar) {
          const p = r.parecido;
          bt.disabled = false;
          conferir.hidden = false;
          return conferir.replaceChildren(
            el("p", { style: "margin:0" }, "Já existe ", el("b", { text: p.nome }), ` nesta cidade (o entregador recebe ${brl(p.recebe)}). É o mesmo bairro?`),
            el("div", { class: "actions" },
              el("button", { class: "btn primary small", type: "button", onclick: (ev) => { ev.currentTarget.disabled = true; salvar(bt, "juntar", p.id); } },
                `É o mesmo: usar o valor de ${p.nome}`),
              el("button", { class: "btn small", type: "button", onclick: (ev) => { ev.currentTarget.disabled = true; salvar(bt, "separado", p.id); } }, "Não, é outro bairro")));
        }
        d.close();
        toast(r?.juntado_com ? `“${nome.value.trim()}” é o mesmo bairro que ${r.juntado_com}: virou outro nome dele, com o mesmo valor (${brl(r.recebe)} para o entregador).`
          : b ? "Bairro atualizado." : "Bairro criado.");
        F.tCidade = cidade.value; App.carregar();
      } catch (err) { bt.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
    }
  }

  // ---------- mensagens prontas (009c) ----------
  // marcadores: {nome} {infracao} {regra} {ocorrencia} {punicao} {termino} {agravante} {reincidencia} {cidade}
  //             {estabelecimento} {meu_nome} {leves_limite} {leves_janela} {leves_situacao}
  const M = { dados: null, erro: null, tipo: "", opcao: 1, bloqueios: null, bloqueio: null };
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
  // 009g5: escolher um entregador com restrição e já preencher tudo com os dados do bloqueio
  $("#fe-msg-bloqueio").addEventListener("change", (e) => {
    M.bloqueio = (M.bloqueios || []).find((b) => String(b.id) === e.target.value) || null;
    if (M.bloqueio && App.bloqueios?.varsMensagem) { M.tipo = App.bloqueios.varsMensagem(M.bloqueio).chave; $("#fe-msg-modelo").value = M.tipo; }
    renderMensagens(true);
  });
  async function carregarBloqueiosAtivos() {
    if (M.bloqueios || M.carregandoBq || !S.me?.papel_bloqueios) return;
    M.carregandoBq = true;
    try { M.bloqueios = await rpc("listar_bloqueios", { p_escopo: "ativos" }); } catch (_) { M.bloqueios = []; }
    M.carregandoBq = false; renderMensagens(false);
  }
  ["#fe-msg-nome", "#fe-msg-estab", "#fe-msg-cidade", "#fe-msg-infracao", "#fe-msg-ocorrencia", "#fe-msg-horas", "#fe-msg-agravante"].forEach((s) => $(s).addEventListener("input", () => renderMensagens(true)));
  $("#fe-msg-form").addEventListener("submit", (e) => e.preventDefault());
  $("#fe-msg-copiar").addEventListener("click", () => copiar($("#fe-msg-texto").value, $("#fe-msg-texto")));
  function renderMensagens(refazer = false) {
    const D = M.dados;
    if (!D) { $("#fe-msg-modelos").replaceChildren(carregandoEl()); return; }
    // 009g5: os modelos de bloqueio também entram (preenchidos à mão; pelo bloqueio, "Gerar mensagem" já sai preenchido)
    const livres = D.modelos;
    // um item por tipo no seletor (a versão "para a cidade" entra sozinha quando não há nome)
    const tipos = [...new Map(livres.filter((m) => m.grupo !== "cidade").map((m) => [tipoDe(m), m])).values()];
    const sel = $("#fe-msg-modelo");
    if (sel.options.length !== tipos.length) {
      const grupo = (g, rot) => { const l = tipos.filter((m) => (g === "bloqueio") === (m.grupo === "bloqueio")); return l.length ? el("optgroup", { label: rot }, l.map((m) => el("option", { value: tipoDe(m), text: m.titulo.replace(/\s*\(.*\)$/, "") }))) : null; };
      sel.replaceChildren(...[grupo("outros", "Entregadores e parceiros"), grupo("bloqueio", "Restrição, encerramento e avisos")].filter(Boolean));
    }
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
    // seletor de bloqueio (só nos modelos de bloqueio, para quem tem o módulo de bloqueios)
    const ehBloqueio = livres.find((m) => tipoDe(m) === M.tipo)?.grupo === "bloqueio";
    const caixaBq = $("#fe-msg-bloqueio-box"), selBq = $("#fe-msg-bloqueio");
    caixaBq.hidden = !ehBloqueio || !S.me?.papel_bloqueios;
    if (ehBloqueio) carregarBloqueiosAtivos();
    if (M.bloqueio && !ehBloqueio) { M.bloqueio = null; }
    const lbq = (M.bloqueios || []);
    if (selBq.dataset.sig !== String(lbq.length)) {
      selBq.dataset.sig = String(lbq.length);
      selBq.replaceChildren(el("option", { value: "", text: M.bloqueios ? (lbq.length ? "Preencher à mão" : "Ninguém com restrição agora") : "Carregando…" }),
        ...lbq.map((b) => el("option", { value: b.id, text: `${b.nome || "ID " + b.id_app} · ${b.infracao}${b.fim ? " · até " + new Date(b.fim).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" , timeZone: App.u.FUSO }) : ""}` })));
    }
    selBq.value = M.bloqueio ? String(M.bloqueio.id) : "";
    // com um bloqueio escolhido, os campos à mão somem e a mensagem sai com os dados dele
    if (M.bloqueio && ehBloqueio && App.bloqueios?.varsMensagem) {
      document.querySelectorAll("[data-msg-campo]").forEach((x) => (x.hidden = true));
      const { v } = App.bloqueios.varsMensagem(M.bloqueio);
      const mb = livres.find((m) => tipoDe(m) === M.tipo);
      if (refazer && mb) $("#fe-msg-texto").value = preencher(mb.texto, { meu_nome: primeiroNome(S.me?.nome), leves_limite: D.leves?.limite, leves_janela: D.leves?.janela_dias, ...v });
      return renderListas(D);
    }
    // infrações para os modelos de bloqueio (a leve só mostra as leves, os outros só as normais)
    const si = $("#fe-msg-infracao"), leve = M.tipo === "leve";
    const infs = D.infracoes.filter((i) => i.ativa !== false && !!i.leve === leve);
    if (si.dataset.sig !== String(leve)) { si.dataset.sig = String(leve); si.replaceChildren(el("option", { value: "", text: "Escolha a infração" }), ...infs.map((i) => el("option", { value: i.id, text: i.nome }))); }
    if (refazer && mod) {
      const inf = D.infracoes.find((i) => String(i.id) === si.value);
      const nomeInf = (inf?.nome || "").replace(/\s*\(aviso\)\s*$/i, "");
      const horas = Number($("#fe-msg-horas").value) || null, oc = Number($("#fe-msg-ocorrencia").value) || 1;
      const agr = $("#fe-msg-agravante").value.trim();
      const Bq = App.bloqueios || {};
      $("#fe-msg-texto").value = preencher(mod.texto, { nome: nome || "[nome]",
        estabelecimento: $("#fe-msg-estab").value.trim() || "[estabelecimento]", cidade: cs.value || "[cidade]", meu_nome: primeiroNome(S.me?.nome),
        infracao: inf ? (leve ? nomeInf.charAt(0).toLowerCase() + nomeInf.slice(1) : nomeInf) : "[infração]",
        regra: inf?.explicacao || "[explique a regra]",
        ocorrencia: Bq.ord ? Bq.ord(oc) : `${oc}ª`,
        punicao: horas ? (Bq.horasTxt ? Bq.horasTxt(horas) : `${horas} h`) : "[tempo da restrição]",
        termino: horas && Bq.termino ? Bq.termino(new Date(Date.now() + horas * 3600000).toISOString()) : "[término]",
        agravante: agr ? `Foi considerado também: ${agr.charAt(0).toLowerCase() + agr.slice(1)}.\n` : "",
        reincidencia: M.tipo === "encerramento" && oc > 1 ? `Esta foi a sua ${oc}ª ocorrência desse tipo, e a política prevê o encerramento a partir dela.\n` : "",
        leves_limite: D.leves?.limite, leves_janela: D.leves?.janela_dias, leves_situacao: "" });
    }
    renderListas(D);
  }
  function renderListas(D) {
    // lista dos modelos (moderador edita)
    $("#fe-msg-modelos").replaceChildren(el("ul", { class: "lista-modelos" }, D.modelos.map((m) => el("li", {},
      el("strong", { text: m.titulo }), el("span", { class: "meta", text: (opcaoDe(m) > 1 || D.modelos.some((x) => x !== m && tipoDe(x) === tipoDe(m)) ? ` · opção ${opcaoDe(m)}` : "") + (m.grupo === "bloqueio" ? " · também pelo “Gerar mensagem” do bloqueio" : "") }),
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
          const bt = e.currentTarget; bt.disabled = true; erroJ.hidden = true;
          try { await rpc("salvar_modelo_mensagem", { p_chave: m.chave, p_texto: area.value }); d.close(); toast("Modelo salvo."); await carregarMensagens(true); render(); }
          catch (err) { bt.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
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
          const bt = e.currentTarget; bt.disabled = true; erroJ.hidden = true;
          try { await rpc("salvar_explicacao_infracao", { p_infracao: i.id, p_explicacao: area.value, p_agravante: ag.value || null, p_agravante_efeito: ag.value ? ef.value : null });
                d.close(); toast("Regra salva."); await carregarMensagens(true); render(); }
          catch (err) { bt.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
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
      { id: "mensagens", nome: "Mensagens prontas", secao: "v-fe-mensagens" },
    ],
    async carregar(aba) {
      try { F.dados = await rpc("tarifas_bairros"); if (aba === "mensagens") await carregarMensagens(true); F.erro = null; } catch (e) { F.erro = msgErro(e); throw e; }
      // 009p: pares de bairros com nome parecido (só para quem edita; sem a migração no banco, fica sem a lista)
      if (aba !== "mensagens" && F.dados?.pode_editar) F.parecidos = await rpc("bairros_parecidos").catch(() => null);
    },
    render(aba) { App.atalhoPendentes(); if (aba === "mensagens") renderMensagens(); else { renderCalc(); renderTarifas(); renderParecidos(); } },  // 009k: as tarifas ficam na calculadora
  });
})();
