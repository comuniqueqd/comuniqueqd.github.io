// Módulo "Casos 🕵️" (migração 008, "Espionagem profissional"): casos suspeitos de uso do cadastro por terceiros.
// Qualquer pessoa da equipe investiga, marca o checklist e comenta; monitorador e moderador dão o veredito.
// Também: o aviso na hora do envio (App.casos.avisar), o placar do detetive (aba das Análises)
// e o selo 🕵️ usado nas outras telas (App.casos.selo).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, duracao, fmtCPF, norm, toast, vazio, carregandoEl, rpc, msgErro, tabela, janela } = App.u;
  const S = App.S;
  const C = { ver: "aberto", dados: {}, notas: {}, comentarios: {}, placar: null, placarDias: 30 };
  const render = () => App.render();
  const carregar = () => App.carregar();
  const mod = () => S.me?.papel === "moderador";
  const TIPO = { cpf_repetido: "CPF repetido com outro nome ou ID", encerrado_voltando: "Encerrado tentando voltar", troca_aprovado: "Troca de dados num cadastro aprovado" };
  const nivelTag = (n) => el("span", { class: "nivel " + n, text: n === "forte" ? "🔴 Sinal forte" : "🟡 Atenção" });

  // selo para cartões e tabelas das outras telas
  const selo = (titulo = "Há um caso suspeito aberto") => el("a", { class: "selo-caso", href: "#casos", title: titulo, onclick: (e) => e.stopPropagation() }, "🕵️ caso aberto");

  // ---------- aviso na hora do envio ----------
  // r = resposta do enviar_cadastro: { id, caso, nivel, detalhe, erro }
  function avisar(r) {
    const d = janela("Cadastro suspeito de uso por terceiros",
      el("div", { class: "quadrinho grave" }, el("b", { text: r.nivel === "forte" ? "🔴 Sinal forte" : "🟡 Atenção" }), r.detalhe || "Os dados não batem com um cadastro que já existe."),
      el("p", { style: "margin:0", text: r.id
        ? "O cadastro foi enviado, mas um caso suspeito foi aberto e a equipe foi avisada."
        : "O cadastro não foi criado (o CPF já existe). A tentativa ficou registrada num caso suspeito e a equipe foi avisada." }),
      el("p", { class: "meta", style: "margin:0", text: "Você mesmo verifica, ou pede para o responsável da cidade (sem responsável, os moderadores)?" }),
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => assumir(r.caso, "eu", e.currentTarget, d) }, "Eu verifico"),
        el("button", { class: "btn", type: "button", onclick: (e) => assumir(r.caso, "pedir", e.currentTarget, d) }, "Pedir verificação"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Decidir depois")));
    return d;
  }
  async function assumir(id, acao, btn, d) {
    btn.disabled = true;
    try {
      await rpc("assumir_caso", { p_caso: id, p_acao: acao });
      d?.close();
      toast(acao === "eu" ? "O caso está com você. Ele aparece em Casos e nas suas Pendências." : "Pedido de verificação enviado.");
      carregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }

  // ---------- lista de casos ----------
  const buscaCaso = (k, q) => !q || norm([k.detalhe, k.nome, k.id_app, k.cpf, fmtCPF(k.cpf), k.cidade, k.cadastro?.nome, k.cadastro?.id_app,
    k.criado_por_nome, k.investigador_nome].join(" ")).includes(norm(q));
  function linhaCadastro(rotulo, c) {
    if (!c) return null;
    return el("div", { class: "meta" }, el("b", { text: rotulo + ": " }),
      `${c.nome || "(sem nome)"} · ID ${c.id_app || "—"} · CPF ${c.cpf ? fmtCPF(c.cpf) : "—"} · ${c.cidade} · ${c.situacao}`, " ",
      el("button", { class: "btn link", type: "button", onclick: () => App.abrirCadastro(c.id) }, "Abrir cadastro"),
      S.me.papel_bloqueios && c.id_app ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirFicha(c.id_app) }, "Consultar entregador") : null);
  }
  function cartao(k, checklist) {
    const aberto = k.status === "aberto";
    const nota = C.notas[k.id] ?? "";
    const txtNota = el("textarea", { rows: "2", maxlength: "1500", placeholder: "O que foi verificado? (obrigatório para o veredito)", "aria-label": "Nota do veredito", oninput: (e) => (C.notas[k.id] = e.target.value) });
    txtNota.value = nota;
    const txtCom = el("textarea", { rows: "2", maxlength: "1500", placeholder: "Comentário sobre a investigação", "aria-label": "Comentário no caso", oninput: (e) => (C.comentarios[k.id] = e.target.value) });
    txtCom.value = C.comentarios[k.id] ?? "";
    const pendente = (c) => c && ["aguardando_analise", "aguardando_contato"].includes(c.status);
    const sugerirEncerrar = k.status === "confirmado" && ["moderador", "monitorador"].includes(S.me.papel) ? [k.novo_cadastro, k.cadastro].find(pendente) : null;
    return el("article", { class: "card caso " + k.nivel + (aberto ? "" : " tratada") + (k.para_mim ? " destaque" : ""), "data-id": k.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, nivelTag(k.nivel), el("span", { class: "tag", text: TIPO[k.tipo] }), k.para_mim ? el("span", { class: "tag", text: "PARA VOCÊ" }) : null),
        el("span", { class: "meta", text: aberto ? `aberto há ${duracao(k.criado_em).txt}` : `${k.status === "confirmado" ? "Confirmado" : "Descartado"} em ${dt(k.veredito_em)}` })),
      el("p", { style: "margin:0", text: k.detalhe }),
      el("div", { class: "meta", text: `Aberto por ${k.criado_por_nome || "Sistema"} em ${dt(k.criado_em)}` + (k.cidade ? ` · ${k.cidade}` : "") }),
      linhaCadastro("Cadastro que já existia", k.cadastro),
      linhaCadastro("Cadastro novo", k.novo_cadastro),
      aberto ? el("div", { class: "bullet " + (k.investigador_nome || k.responsavel_nome ? "pendente" : "sem") },
        k.investigador_nome ? `Investigando: ${k.investigador_nome} desde ${dt(k.investigando_desde)}`
          : k.responsavel_nome ? `Verificação pedida para ${k.responsavel_nome} em ${dt(k.verificacao_pedida_em)}` : "Ninguém investigando ainda") : null,
      !aberto ? el("div", { class: "bullet concluida" }, el("span", {}, el("b", { text: `Veredito de ${k.veredito_por_nome}: ` }), k.veredito_nota)) : null,
      sugerirEncerrar ? el("div", { class: "quadrinho" }, el("b", { text: "Sugestão: " }), `encerrar o cadastro ${sugerirEncerrar.nome || "ID " + (sugerirEncerrar.id_app || "—")} na tela de Pendentes.`,
        el("button", { class: "btn link", type: "button", onclick: () => { S.caixa[sugerirEncerrar.id] = { acao: "encerrar", motivo: "", detalhe: "" }; location.hash = "#ativacao/pendentes"; } }, "Abrir para encerrar")) : null,
      // checklist
      checklist.length || Object.keys(k.checklist).length ? el("div", { class: "checklist" }, el("b", { text: "Checklist" }),
        ...[...new Set([...checklist, ...Object.keys(k.checklist)])].map((item) => {
          const feito = k.checklist[item];
          const cb = el("input", { type: "checkbox", disabled: !aberto, onchange: async (e) => {
            const alvo = e.target; alvo.disabled = true;
            try { await rpc("marcar_checklist_caso", { p_caso: k.id, p_item: item, p_feito: alvo.checked }); carregar(); }
            catch (err) { alvo.checked = !alvo.checked; alvo.disabled = false; toast(msgErro(err)); } } });
          cb.checked = !!feito;
          return el("label", { class: "marcar" }, cb, item, feito ? el("span", { class: "meta", text: ` · ${feito.por} em ${dt(feito.em)}` }) : null);
        })) : null,
      // comentários
      k.comentarios.length ? el("ul", { class: "comentarios" }, k.comentarios.map((x) => el("li", {},
        el("div", { class: "quem" }, el("span", { text: `${x.por_nome || "—"} · ${dt(x.em)}` })), el("div", { text: x.texto })))) : null,
      aberto ? el("div", { style: "display:grid;gap:6px" }, txtCom,
        el("div", { class: "actions" },
          el("button", { class: "btn small", type: "button", onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try { await rpc("comentar_caso", { p_caso: k.id, p_texto: C.comentarios[k.id] || "" }); delete C.comentarios[k.id]; carregar(); }
            catch (err) { b.disabled = false; toast(msgErro(err)); } } }, "Comentar"),
          !k.investigador_nome || !k.para_mim ? el("button", { class: "btn small", type: "button", onclick: (e) => assumir(k.id, "eu", e.currentTarget) }, "Eu verifico") : null,
          !k.responsavel_nome ? el("button", { class: "btn link", type: "button", onclick: (e) => assumir(k.id, "pedir", e.currentTarget) }, "Pedir verificação") : null)) : null,
      // veredito
      k.pode_veredito ? el("div", { class: "box" }, el("b", { text: "Veredito" }), txtNota,
        el("div", { class: "actions" },
          el("button", { class: "btn reject small", type: "button", onclick: (e) => veredito(k, "confirmado", e.currentTarget) }, "Confirmar: era terceiro"),
          el("button", { class: "btn approve small", type: "button", onclick: (e) => veredito(k, "descartado", e.currentTarget) }, "Descartar: estava tudo certo"))) : null);
  }
  async function veredito(k, v, btn) {
    if (!String(C.notas[k.id] || "").trim()) return toast("Escreva o que foi verificado.");
    btn.disabled = true;
    try {
      await rpc("veredito_caso", { p_caso: k.id, p_veredito: v, p_nota: C.notas[k.id] });
      delete C.notas[k.id];
      toast(v === "confirmado" ? "Caso confirmado. Um comentário foi gravado na ficha do entregador." : "Caso descartado.");
      carregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  function renderCasos() {
    document.querySelectorAll("[data-casos]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.casos === C.ver)));
    const box = $("#casos-lista"), d = C.dados[C.ver];
    $("#casos-checklist-box").hidden = !mod();
    if (!d) return box.replaceChildren(carregandoEl());
    const ta = $("#casos-checklist");
    if (document.activeElement !== ta) ta.value = d.checklist.join("\n");
    const q = $("#q-casos").value;
    const lista = d.casos.filter((k) => buscaCaso(k, q));
    if (!d.casos.length) return box.replaceChildren(vazio(C.ver === "aberto" ? "Nenhum caso aberto" : "Nenhum caso encerrado nos últimos 90 dias",
      C.ver === "aberto" ? "Quando um cadastro parecer uso por terceiros, o caso aparece aqui e a equipe recebe um aviso." : ""));
    if (!lista.length) return box.replaceChildren(vazio("Nenhum caso com essa busca", "Limpe a busca."));
    const meus = lista.filter((k) => k.para_mim), outros = lista.filter((k) => !k.para_mim);
    box.replaceChildren(...[
      meus.length ? el("div", { class: "grupo" }, el("h3", {}, "Para você verificar", el("span", { class: "count alert", text: meus.length })), el("div", { class: "queue" }, meus.map((k) => cartao(k, d.checklist)))) : null,
      outros.length ? el("div", { class: "grupo" }, el("h3", {}, meus.length ? "Os outros casos" : C.ver === "aberto" ? "Casos abertos" : "Casos encerrados", el("span", { class: "count", text: outros.length })),
        el("div", { class: "queue" }, outros.map((k) => cartao(k, d.checklist)))) : null].filter(Boolean));
  }
  document.querySelectorAll("[data-casos]").forEach((b) => b.addEventListener("click", () => { C.ver = b.dataset.casos; render(); carregar(); }));
  $("#q-casos").addEventListener("input", render);
  $("#b-checklist").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const itens = $("#casos-checklist").value.split("\n").map((x) => x.trim()).filter(Boolean);
    try { await rpc("salvar_checklist_casos", { p_itens: itens }); toast("Checklist atualizado."); carregar(); }
    catch (err) { toast(msgErro(err)); } finally { b.disabled = false; }
  });

  // ---------- placar do detetive (aba das Análises) ----------
  async function carregarPlacar() { C.placar = await rpc("placar_detetive", { p_dias: C.placarDias }); }
  function renderPlacar() {
    document.querySelectorAll("[data-placar]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.placar) === C.placarDias)));
    const p = C.placar;
    const tile = (k, v, cls = "") => el("div", { class: "tile " + cls }, el("div", { class: "k", text: k }), el("div", { class: "v", text: p ? v : "…" }));
    $("#placar-tiles").replaceChildren(tile("Casos abertos agora", p?.abertos, "hl"), tile("Abertos no período", p?.abertos_no_periodo),
      tile("Confirmados", p?.confirmados, "hl2"), tile("Descartados", p?.descartados, "good"));
    const medalha = (i) => ["🥇", "🥈", "🥉"][i] || "";
    $("#t-placar").replaceChildren(...tabela([["Detetive"], ["Casos resolvidos", 1], ["Confirmados", 1], ["Investigando agora", 1], ["Comentários", 1]],
      (p?.pessoas || []).map((x, i) => el("tr", {}, el("td", { text: `${medalha(i)} ${x.nome}`.trim() }),
        ...[x.resolvidos, x.confirmados, x.investigando, x.comentarios].map((v) => el("td", { class: "num", text: v })))),
      p ? "Ninguém investigou casos neste período ainda." : "Carregando…"));
  }
  document.querySelectorAll("[data-placar]").forEach((b) => b.addEventListener("click", () => { C.placarDias = Number(b.dataset.placar); C.placar = null; render(); carregar(); }));

  App.casos = { avisar, selo, carregarPlacar, renderPlacar, assumir };
  App.modulo({
    id: "casos", nome: "Casos",
    abas: [{ id: "casos", nome: "Casos", secao: "v-casos" }],
    carregar: async () => { C.dados[C.ver] = await rpc("listar_casos", { p_status: C.ver }); },
    render: renderCasos,
    contadores() {
      const r = S.resumo;
      if (!r) return;
      const n = r.casos_para_mim || r.casos_abertos || 0;
      App.contador("c-casos", n);
      // vermelho só quando há caso esperando por você; senão, número neutro
      document.querySelectorAll('[data-espelho="c-casos"]').forEach((c) => {
        c.classList.toggle("alert", !!r.casos_para_mim);
        c.title = r.casos_para_mim ? `${r.casos_para_mim} caso(s) para você verificar` : `${r.casos_abertos} caso(s) aberto(s)`;
      });
    },
  });
})();
