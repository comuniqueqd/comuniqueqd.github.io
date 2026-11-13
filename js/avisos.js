// Avisos (008b, parte 1): a tira do sino (os avisos recentes sem sair da tela), a tela de Avisos com
// busca e filtros (listar_avisos) e as cidades sem responsável, com o pedido para ser a responsável.
// Os pedidos esperando resposta aparecem nas Pendências dos moderadores (js/atividades.js).
// 008d: o que a pessoa acompanha (seguir cidade, "de olho nele"), o que ela silenciou e o resumo do dia na tira.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, janela } = App.u;
  const S = App.S;
  const V = { lista: null, mais: false, cidades: [], carregandoMais: false, semResp: null, marcando: false, pref: null, dia: null };
  const FILTROS = [["", "Todos os avisos"], ["pessoal", "Para você (tarefas e decisões)"], ["ativacao", "Ativação"],
    ["bloqueios", "Bloqueios"], ["leves", "Infrações leves (agrupadas)"], ["comentarios", "Comentários e fichas"], ["cidades", "Pedidos de cidade"], ["financeiro", "Financeiro"]];
  const ROTULO = { ativacao: "ATIVAÇÃO", bloqueios: "BLOQUEIOS", leves: "LEVES", comentarios: "FICHA", cidades: "CIDADE", financeiro: "FINANCEIRO", ajuda: "AJUDA", aviso_geral: "AVISO GERAL", turno: "TURNO" };
  const porque = (x) => ({ cidade: `você é responsável por ${x.cidade}`, moderador: "você é moderador", seguindo: `você segue ${x.cidade}`,
    de_olho: "você está de olho neste entregador" })[x.motivo] || null;
  // tipos que dá para silenciar (o que é para você e o "de olho nele" sempre chegam)
  const TIPOS = [["ativacao", "Ativação (cadastros enviados e decididos)"], ["bloqueios", "Bloqueios, tratativas e correções"],
    ["leves", "Infrações leves (um aviso por cidade e dia)"], ["comentarios", "Comentários e alterações nas fichas"], ["cidades", "Pedidos para ser responsável de cidade"], ["financeiro", "Financeiro (adicionais e ajustes de bairro)"]];

  // ---------- o que acompanho e o que recebo ----------
  async function carregarPref() { V.pref = await rpc("minhas_preferencias"); return V.pref; }
  const seguindo = (tipo, alvo) => !!V.pref?.seguindo.some((x) => x.tipo === tipo && x.alvo === alvo);
  async function alternar(tipo, alvo, seguir, btn) {
    if (btn) btn.disabled = true;
    try {
      V.pref = await rpc("seguir", { p_tipo: tipo, p_alvo: alvo, p_seguir: seguir });
      toast(tipo === "entregador" ? (seguir ? "Você está de olho: recebe tudo o que acontecer com ele." : "Você não está mais de olho nele.")
        : (seguir ? `Você segue ${alvo}: recebe os avisos da cidade.` : `Você deixou de seguir ${alvo}.`));
      App.render();
    } catch (e) { toast(msgErro(e)); } finally { if (btn) btn.disabled = false; }
  }
  // botão da ficha do entregador (js/bloqueios.js)
  function botaoOlho(id) {
    if (!V.pref) { carregarPref().then(() => App.render()).catch(() => {}); return null; }
    const on = seguindo("entregador", id);
    return el("button", { class: "btn small olho", type: "button", "aria-pressed": String(on), title: on ? "Parar de acompanhar" : "Receber aviso de tudo o que acontecer com este entregador",
      onclick: (e) => alternar("entregador", id, !on, e.currentTarget) }, on ? "👀 De olho nele" : "👀 Ficar de olho");
  }
  function renderPref() {
    const box = $("#av-prefs"), p = V.pref;
    if (!p) return box.replaceChildren();
    const sil = new Set(p.silenciados);
    const cidadesSeg = p.seguindo.filter((x) => x.tipo === "cidade"), olhos = p.seguindo.filter((x) => x.tipo === "entregador");
    const sel = el("select", { "aria-label": "Cidade para seguir" }, el("option", { value: "", text: "Escolha uma cidade" }),
      ...p.cidades.filter((c) => !cidadesSeg.some((x) => x.alvo === c)).map((c) => el("option", { value: c, text: c })));
    box.replaceChildren(el("details", { class: "panel", open: box.dataset.aberto === "1" ? true : null, ontoggle: (e) => (box.dataset.aberto = e.target.open ? "1" : "") },
      el("summary", {}, el("b", { text: "O que você acompanha e recebe" }),
        el("span", { class: "meta", text: ` · ${cidadesSeg.length} cidade(s) · de olho em ${olhos.length} · ${sil.size ? sil.size + " tipo(s) silenciado(s)" : "recebe tudo"}` })),
      el("div", { class: "prefs-grid" },
        el("div", {}, el("h4", { text: "Receber avisos de" }),
          ...TIPOS.map(([k, t]) => {
            const cb = el("input", { type: "checkbox", switch: true, role: "switch", "data-pref": k }); cb.checked = !sil.has(k);  // 009l: interruptor
            cb.addEventListener("change", async () => {
              const novos = TIPOS.map(([x]) => x).filter((x) => !box.querySelector(`[data-pref="${x}"]`).checked);
              try { V.pref = await rpc("salvar_preferencias", { p_silenciados: novos }); toast("Preferências salvas."); App.render(); } catch (e) { toast(msgErro(e)); }
            });
            return el("label", { class: "marcar" }, cb, t);
          }),
          el("p", { class: "meta", text: "O que é para você (tarefas, decisões dos seus cadastros, previsões vencidas) e o que vem do “de olho nele” sempre chega." })),
        el("div", {}, el("h4", { text: "Cidades que você segue" }),
          cidadesSeg.length ? el("div", { class: "chips-seguindo" }, cidadesSeg.map((x) => el("span", { class: "chip" }, x.alvo,
            el("button", { type: "button", title: "Deixar de seguir", "aria-label": "Deixar de seguir " + x.alvo, onclick: (e) => alternar("cidade", x.alvo, false, e.currentTarget) }, "✕"))))
            : el("p", { class: "meta", text: "Nenhuma. Siga uma cidade para receber os avisos dela sem ser a responsável." }),
          el("div", { class: "actions" }, sel, el("button", { class: "btn small", type: "button", onclick: (e) => sel.value && alternar("cidade", sel.value, true, e.currentTarget) }, "Seguir cidade"))),
        S.me.papel_bloqueios ? el("div", {}, el("h4", { text: "De olho em" }),
          olhos.length ? el("ul", { class: "meus-pedidos" }, olhos.map((x) => el("li", {},
            el("button", { class: "link-ficha", type: "button", onclick: () => App.abrirFicha(x.alvo) }, x.nome || x.alvo), " ", el("span", { class: "mono meta", text: x.alvo }), " ",
            el("button", { class: "btn link", type: "button", onclick: (e) => alternar("entregador", x.alvo, false, e.currentTarget) }, "Parar"))))
            : el("p", { class: "meta", text: "Ninguém. Na ficha do entregador, use “Ficar de olho” para receber tudo o que acontecer com ele." })) : null,
        App.som ? App.som.painel() : null)));
  }

  // resumo do dia na tira do sino
  function linhaDia() {
    const d = V.dia;
    if (!d) return el("div", { class: "resumo-dia", text: "Hoje: carregando…" });
    const partes = [[d.cadastros, "cadastro(s)"], [d.aprovados, "aprovado(s)"], [d.bloqueios, "bloqueio(s)"], [d.leves, "leve(s)"],
      [d.tratativas, "tratativa(s) resolvida(s)"], [d.saem_hoje, "saem do bloqueio hoje"]].filter(([v]) => v != null);
    return el("div", { class: "resumo-dia" }, el("b", { text: "Hoje na equipe: " }), partes.map(([v, t]) => `${v} ${t}`).join(" · "),
      el("br"), `Você fez ${d.voce} registro(s) hoje.`);
  }

  function marcarLidos() {
    if (!S.notif?.nao_lidas || V.marcando) return;
    V.marcando = true;
    rpc("marcar_notificacoes_lidas").then(() => { S.notif = { ...S.notif, nao_lidas: 0 }; App.render(); })
      .catch((e) => toast(msgErro(e))).finally(() => (V.marcando = false));
  }
  const etiqueta = (x) => el("span", { class: "tag", text: ROTULO[x.categoria] || "PARA VOCÊ" });
  function linhaAviso(x, aoAbrir) {
    return el("li", { class: "aviso" + (x.lida ? "" : " novo") },
      el("a", { href: x.link || "#atividades/avisos", onclick: aoAbrir },
        el("div", { class: "aviso-topo" }, etiqueta(x), el("span", { class: "meta", text: dt(x.criada_em) })),
        el("div", { class: "aviso-texto", text: x.texto }),
        porque(x) ? el("div", { class: "meta", text: "Você recebeu porque " + porque(x) + "." }) : null));
  }

  // ---------- tira do sino ----------
  // 009i (Modern Web Guidance): a tira é um popover="auto" ligado ao sino por popovertarget. O navegador
  // fecha com Esc e com clique fora, marca o aria-expanded do sino e põe a tira na camada de cima.
  // Sem popover no navegador, vale o jeito antigo (hidden + cliques e Esc tratados aqui).
  const temPopover = App.u.temPopover;
  const sino = $("#b-avisos");
  const tira = el("div", { class: "tira-avisos", id: "tira-avisos", role: "dialog", "aria-label": "Avisos recentes" });
  document.body.append(tira);
  if (temPopover) { tira.setAttribute("popover", "auto"); sino.setAttribute("popovertarget", "tira-avisos"); }
  else { tira.hidden = true; sino.setAttribute("aria-expanded", "false"); }
  const tiraAberta = () => (temPopover ? tira.matches(":popover-open") : !tira.hidden);
  function fecharTira() {
    if (!tiraAberta()) return;
    if (temPopover) tira.hidePopover(); else { tira.hidden = true; sino.setAttribute("aria-expanded", "false"); }
  }
  function preencherTira() {
    const n = S.notif, itens = n?.itens || [];
    const b = sino.getBoundingClientRect();
    tira.style.top = `${b.bottom + scrollY + 6}px`;
    tira.style.right = `${Math.max(8, document.documentElement.clientWidth - b.right)}px`;
    tira.replaceChildren(
      el("div", { class: "tira-topo" }, el("b", { text: n?.nao_lidas ? `${n.nao_lidas} aviso(s) novo(s)` : "Avisos recentes" }),
        el("button", { class: "btn link", type: "button", onclick: fecharTira, "aria-label": "Fechar" }, "✕")),
      linhaDia(),
      itens.length ? el("ul", { class: "lista-avisos" }, itens.slice(0, 12).map((x) => linhaAviso(x, () => fecharTira())))
        : el("p", { class: "meta", style: "padding:12px", text: "Nenhum aviso ainda." }),
      el("div", { class: "tira-pe" }, el("a", { class: "btn small", href: "#atividades/avisos", onclick: fecharTira }, "Ver todos os avisos")));
    rpc("resumo_do_dia").then((d) => { V.dia = d; const velha = tira.querySelector(".resumo-dia"); if (velha) velha.replaceWith(linhaDia()); }).catch(() => {});
    marcarLidos();
  }
  function abrirTira() {
    if (tiraAberta()) return;
    if (temPopover) tira.showPopover({ source: sino }); else { preencherTira(); tira.hidden = false; sino.setAttribute("aria-expanded", "true"); }
  }
  if (temPopover) {
    tira.addEventListener("beforetoggle", (e) => { if (e.newState === "open") preencherTira(); });
  } else {
    sino.addEventListener("click", (e) => { e.stopPropagation(); tira.hidden ? abrirTira() : fecharTira(); });
    document.addEventListener("click", (e) => { if (!tira.hidden && !tira.contains(e.target)) fecharTira(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tira.hidden) fecharTira(); });
  }
  addEventListener("hashchange", fecharTira);

  // ---------- tela de Avisos ----------
  const filtros = () => ({ p_busca: $("#av-q").value.trim() || null, p_filtro: $("#av-filtro").value || null,
    p_cidade: $("#av-cidade").value || null, p_nao_lidos: $("#av-nao-lidos").checked });
  async function carregar() {
    const [r, sr] = await Promise.all([rpc("listar_avisos", filtros()), rpc("cidades_sem_responsavel"), carregarPref()]);
    V.lista = r.itens; V.mais = r.mais; V.cidades = r.cidades; V.semResp = sr;
  }
  async function maisAvisos(btn) {
    btn.disabled = true;
    try {
      const r = await rpc("listar_avisos", { ...filtros(), p_antes: V.lista[V.lista.length - 1].id });
      V.lista = V.lista.concat(r.itens); V.mais = r.mais;
      render();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  let espera = null;
  const refiltrar = () => { clearTimeout(espera); espera = setTimeout(async () => {
    try { const r = await rpc("listar_avisos", filtros()); V.lista = r.itens; V.mais = r.mais; V.cidades = r.cidades; render(); } catch (e) { toast(msgErro(e)); } }, 300); };
  $("#av-filtro").replaceChildren(...FILTROS.map(([v, t]) => el("option", { value: v, text: t })));
  for (const id of ["#av-filtro", "#av-cidade", "#av-nao-lidos"]) $(id).addEventListener("change", refiltrar);
  $("#av-q").addEventListener("input", refiltrar);

  function render() {
    const sel = $("#av-cidade"), atual = sel.value;
    const ops = ["", ...V.cidades].join("|");
    if (sel.dataset.ops !== ops) {
      sel.dataset.ops = ops;
      sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...V.cidades.map((c) => el("option", { value: c, text: c })));
      sel.value = atual;
    }
    const box = $("#at-avisos");
    if (!V.lista) box.replaceChildren(carregandoEl());
    else if (!V.lista.length) box.replaceChildren(vazio("Nenhum aviso", filtros().p_busca || filtros().p_filtro || filtros().p_cidade || filtros().p_nao_lidos
      ? "Nada com esses filtros. Tente outra palavra ou limpe os filtros." : "Quando algo acontecer nas suas cidades, ou para você, o aviso aparece aqui."));
    else box.replaceChildren(...[el("ul", { class: "lista-avisos pagina" }, V.lista.map((x) => linhaAviso(x))),
      V.mais ? el("div", { class: "actions" }, el("button", { class: "btn", type: "button", onclick: (e) => maisAvisos(e.currentTarget) }, "Carregar mais avisos")) : null].filter(Boolean));
    App.u.grifar("busca-tela", box, $("#av-q").value);  // 009l: grifa o termo buscado
    renderPref();
    renderCidades();
    marcarLidos();
  }

  // ---------- cidades sem responsável ----------
  function renderCidades() {
    const box = $("#av-cidades"), d = V.semResp;
    if (!d) return box.replaceChildren();
    const meus = (d.meus || []).slice(0, 5);
    box.replaceChildren(el("details", { class: "panel", open: box.dataset.aberto === "1" ? true : null, ontoggle: (e) => (box.dataset.aberto = e.target.open ? "1" : "") },
      el("summary", {}, el("b", { text: d.cidades.length ? `Cidades sem responsável (${d.cidades.length})` : "Todas as cidades têm responsável" }),
        d.cidades.length ? el("span", { class: "meta", text: " · quer acompanhar uma? Peça para ser a responsável" }) : null),
      el("p", { class: "meta", text: "Os avisos destas cidades vão só para os moderadores. Quer acompanhar uma delas? Peça para ser a responsável: um moderador aprova, e você passa a receber tudo o que acontece lá." }),
      d.cidades.length ? el("ul", { class: "cidades-livres" }, d.cidades.map((c) => el("li", {},
        el("span", {}, c.cidade, c.pedidos ? el("span", { class: "meta", text: ` · ${c.pedidos} pedido(s) esperando` }) : null),
        c.meu_pedido ? el("span", { class: "tag", text: "Você já pediu" })
          : el("button", { class: "btn link", type: "button", onclick: (e) => pedir(c.cidade, e.currentTarget) }, "Pedir para ser responsável")))) : null,
      meus.length ? el("div", {}, el("h4", { style: "margin:12px 0 6px", text: "Seus pedidos" }),
        el("ul", { class: "meus-pedidos" }, meus.map((p) => el("li", {},
          `${p.cidade} · ${p.status === "pendente" ? "esperando resposta" : p.status === "aprovado" ? "aprovado" : "recusado"}`,
          p.decidido_por_nome && p.status !== "pendente" ? ` por ${p.decidido_por_nome}` : "", p.nota ? ` · ${p.nota}` : "",
          p.status === "pendente" ? el("button", { class: "btn link", type: "button", onclick: (e) => cancelar(p.id, e.currentTarget) }, "Cancelar pedido") : null)))) : null));
  }
  async function pedir(cidade, btn) {
    btn.disabled = true;
    try { await rpc("pedir_cidade", { p_cidade: cidade }); toast("Pedido enviado. Um moderador vai aprovar ou recusar."); await carregar(); render(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function cancelar(id, btn) {
    btn.disabled = true;
    try { await rpc("cancelar_pedido_cidade", { p_id: id }); toast("Pedido cancelado."); await carregar(); render(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }

  // ---------- pedidos para o moderador (cartões nas Pendências) ----------
  function decidir(p, aprovar, btn) {
    if (aprovar) {
      btn.disabled = true;
      return rpc("decidir_pedido_cidade", { p_id: p.id, p_aprovar: true })
        .then(() => { toast(`${p.nome} agora é responsável por ${p.cidade}.`); App.carregar(); })
        .catch((e) => { btn.disabled = false; toast(msgErro(e)); });
    }
    const nota = el("textarea", { rows: "2", maxlength: "300", placeholder: "Ex.: a cidade vai ficar com outra pessoa." });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = janela("Recusar pedido de cidade",
      el("p", { style: "margin:0", text: `${p.nome} pediu para ser responsável por ${p.cidade}.` }),
      el("label", {}, "Motivo (a pessoa recebe)", nota), erro,
      el("div", { class: "actions" },
        el("button", { class: "btn reject", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; erro.hidden = true;
          try { await rpc("decidir_pedido_cidade", { p_id: p.id, p_aprovar: false, p_nota: nota.value.trim() || null }); d.close(); toast("Pedido recusado."); App.carregar(); }
          catch (err) { b.disabled = false; erro.textContent = msgErro(err); erro.hidden = false; }
        } }, "Recusar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    nota.focus();
  }
  function cartoesPedidos(item) {
    return (S.resumo?.pedidos_cidade || []).map((p) => item({ modulo: "CIDADE", titulo: `${p.nome} pediu para ser responsável por ${p.cidade}`,
      detalhe: `Pedido feito há ${App.u.duracao(p.criado_em).txt}. Aprovado, a pessoa passa a receber todos os avisos da cidade` +
        (["moderador", "monitorador"].includes(p.papel_bloqueios) ? " e as tratativas." : ". As tratativas continuam com os moderadores (para recebê-las, a pessoa precisa ser monitorador ou moderador dos bloqueios)."),
      acoes: [el("button", { class: "btn approve small", type: "button", onclick: (e) => decidir(p, true, e.currentTarget) }, "Aprovar"),
        el("button", { class: "btn link", type: "button", onclick: (e) => decidir(p, false, e.currentTarget) }, "Recusar…")] }));
  }

  App.aoEntrar.push(() => { carregarPref().catch(() => {}); });
  App.avisos = { carregar, render, cartoesPedidos, abrirTira, fecharTira, botaoOlho, carregarPref };
})();
