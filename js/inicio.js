// Tela inicial (008c): em cima, as funções do dia a dia como botões grandes (Nova ativação, Cadastrar
// entregador, Sugerir atividade, Registros); embaixo, os números da pessoa e da equipe, mais discretos
// (o resto dos números fica nas Análises simples).
(() => {
  "use strict";
  const App = window.App;
  const { $, el } = App.u;
  const S = App.S;
  const staffAtiv = () => ["moderador", "monitorador"].includes(S.me?.papel);
  const staffBloq = () => ["moderador", "monitorador"].includes(S.me?.papel_bloqueios);

  // ---------- 009y1f: tira de prévia das linhas de "Precisa de você" (pedido do usuário) ----------
  let tiraAberta = null;
  const tiras = {};   // chave -> { itens, erro, carregando }
  const tempo = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; };
  const real = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  async function acaoTira(fn, args, botao, msg, chave) {
    botao.disabled = true;
    try { await App.u.rpc(fn, args); App.u.toast(msg); await buscarTira(chave); App.carregar(); }
    catch (e) { botao.disabled = false; App.u.toast(App.u.msgErro(e)); }
  }
  async function buscarTira(chave) {
    tiras[chave] = { ...(tiras[chave] || {}), carregando: true, erro: null };
    try {
      let itens = [];
      if (chave === "atrasadas" || chave === "tratativas") {
        const l = await App.u.rpc("listar_tarefas", { p_status: "pendente" });
        itens = l.filter((t) => t.minha && t.tipo !== "completar_dados" && (chave === "tratativas" || t.atrasada))
          .sort((a, b) => (b.atrasada - a.atrasada) || String(a.criada_em).localeCompare(String(b.criada_em)))
          .map((t) => ({ titulo: t.bloqueio?.nome || t.bloqueio?.nome_entregador || (t.bloqueio?.id_app ? "ID " + t.bloqueio.id_app : "Sem nome"),
            detalhe: [t.bloqueio?.infracao, t.cidade, t.atrasada ? `atrasada há ${tempo(t.criada_em)}` : `há ${tempo(t.criada_em)}`].filter(Boolean).join(" · "),
            alerta: t.atrasada,
            acoes: [t.bloqueio?.id_app ? el("button", { class: "btn small", type: "button", onclick: () => App.abrirFicha?.(t.bloqueio.id_app) }, "Ver a ficha") : null,
              el("a", { class: "btn small primary", href: "#bloqueios/tratativas" }, "Tratar")].filter(Boolean) }));
      } else if (chave === "pedidas" || chave === "comigo" || chave === "abertas") {
        const l = await (App.listarAtividades ? App.listarAtividades(0) : App.u.rpc("listar_atividades"));
        const filtro = { pedidas: (a) => a.status === "aberta" && a.para_mim && a.pode_aceitar && !a.opcional_para_mim && !a.automatica,
          comigo: (a) => a.status === "aceita" && a.sou_participante && !a.automatica,
          abertas: (a) => a.status === "aberta" && !a.automatica && a.pode_aceitar && !a.para_mim && !a.opcional_para_mim && a.criada_por !== S.me.id }[chave];
        itens = l.filter(filtro).sort((a, b) => String(a.prazo || "9").localeCompare(String(b.prazo || "9")) || String(a.criada_em).localeCompare(String(b.criada_em)))
          .map((a) => ({ titulo: a.titulo,
            detalhe: [a.cidade, a.prazo ? `prazo ${App.u.dt(a.prazo)}` : "sem prazo", chave !== "comigo" && a.criada_por_nome ? `pedida por ${a.criada_por_nome}` : null].filter(Boolean).join(" · "),
            alerta: !!a.atrasada,
            acoes: chave === "comigo" ? [el("a", { class: "btn small", href: "#atividades/pendencias" }, "Abrir")]
              : [el("button", { class: "btn small primary", type: "button", onclick: (e) => acaoTira("aceitar_atividade", { p_id: a.id }, e.currentTarget, "Tarefa aceita. Ela está com você.", chave) }, "Eu faço")] }));
      } else if (chave === "cadastros") {
        const r = await App.u.rpc("listar_cadastros_pagina", { p_pagina: 1, p_por: 200, p_status: "aguardando_analise" });
        itens = (r.itens || []).sort((a, b) => String(a.enviado_em).localeCompare(String(b.enviado_em)))
          .map((c) => ({ titulo: c.nome || (c.id_app ? "ID " + c.id_app : "Sem ID"),
            detalhe: [c.cidade, `esperando há ${tempo(c.enviado_em)}`, c.enviado_por_nome ? `enviado por ${c.enviado_por_nome}` : null].filter(Boolean).join(" · "),
            acoes: [
              App.decidirCadastro ? el("button", { class: "btn approve small", type: "button", onclick: (e) => App.decidirCadastro.aprovar(c, e.currentTarget, () => buscarTira(chave)) }, "Aprovar") : null,
              App.decidirCadastro ? el("button", { class: "btn reject small", type: "button", onclick: () => App.decidirCadastro.reprovar(c, () => buscarTira(chave)) }, "Reprovar") : null,
              el("button", { class: "btn small", type: "button", onclick: () => App.abrirCadastro?.(c.id) }, "Revisar")].filter(Boolean) }));
      } else if (chave === "lancamentos") {
        const r = await App.u.rpc("listar_lancamentos", { p_pendentes: true, p_meus: true, p_limite: 50 });
        itens = (r.itens || []).map((l) => ({ titulo: `${l.tipo === "adicional" ? "Adicional" : "Ajuste de bairro"} de ${real(l.valor)}`,
          detalhe: [l.nome_entregador, l.cidade, l.pedido ? "pedido " + l.pedido : null, `há ${tempo(l.criado_em)}`].filter(Boolean).join(" · "),
          acoes: [el("button", { class: "btn small primary", type: "button", onclick: (e) => acaoTira("marcar_lancado", { p_id: l.id, p_lancado: true }, e.currentTarget, "Marcado como lançado.", chave) }, "Já lancei")] }));
      }
      tiras[chave] = { itens };
    } catch (e) { tiras[chave] = { itens: [], erro: App.u.msgErro(e) }; }
    if (tiraAberta === chave || Object.values(abertaEm).includes(chave)) App.render();
  }
  function tira(x) {
    const t = tiras[x.chave] || { carregando: true };
    const MAX = 5, itens = t.itens || [];
    return el("div", { class: "precisa-tira", role: "region", "aria-label": "Prévia: " + x.txt },
      t.carregando && !t.itens ? App.u.vazio("Carregando…")
        : t.erro ? el("p", { class: "err", text: t.erro })
        : !itens.length ? el("p", { class: "meta", text: "Nada aqui agora. O número se atualiza em instantes." })
        : el("ul", { class: "tira-cards" }, itens.slice(0, MAX).map((i) => el("li", { class: "tira-card" + (i.alerta ? " alerta" : "") },
            el("div", { class: "tira-txt" }, el("b", { text: i.titulo }), el("span", { class: "meta", text: i.detalhe })),
            i.acoes?.length ? el("div", { class: "tira-acoes" }, ...i.acoes) : null))),
      el("a", { class: "btn link", href: x.href }, itens.length > MAX ? `Ver todos os ${itens.length} na tela completa` : "Abrir a tela completa"));
  }  // 009y2 (pedido do usuário): a mesma prévia em outras telas (Minha fila); host = onde está aberta
  const abertaEm = {};
  App.previa = {
    tira, aberta: (host) => abertaEm[host] || null,
    alternar(host, chave) { abertaEm[host] = abertaEm[host] === chave ? null : chave; if (abertaEm[host]) buscarTira(chave); App.render(); },
  };


  // número principal + linha "N na equipe" (ou "N seus") embaixo
  const numero = (v, rotulo, extra = null, alerta = false) =>
    el("div", { class: alerta && v ? "alerta" : null }, el("b", { text: v ?? "…" }), el("span", { text: rotulo }),
      extra ? el("span", { class: "equipe", text: extra }) : null);
  const naEquipe = (v) => (v == null ? null : `${v} na equipe`);

  // "Nova tarefa" abre a tela já com o formulário aberto e o cursor no título
  function abrirSugerir() {
    setTimeout(() => {
      const box = $("#at-nova-box");
      if (!box) return;
      box.open = true;
      $("#at-titulo")?.focus();
      App.u.rolar(box, { block: "start" });
    }, 60);
  }

  // botão de função: ícone, nome, para que serve e uma linha viva (o que está acontecendo agora)
  const funcao = ({ id, href, icone, titulo, texto, vivo, cor, onclick }) =>
    el("a", { class: "funcao " + cor, href, id, onclick },
      el("span", { class: "funcao-icone" }, App.ic(icone)),
      el("span", { class: "funcao-corpo" },
        el("b", { text: titulo }),
        el("span", { class: "funcao-texto", text: texto }),
        vivo ? el("span", { class: "funcao-vivo", text: vivo }) : null),
      el("span", { class: "funcao-seta", "aria-hidden": "true", text: "→" }));

  // 009c: avisos rápidos (pendências que esperam alguém resolver, ex.: aguardando prestação de contas)
  function resolverRapido(a) {
    const nota = el("input", { maxlength: 300, placeholder: "Ex.: prestou contas na loja às 15h" });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = App.u.janela(a.titulo,
      el("p", { style: "margin:0", text: `${a.nome || "ID " + a.id_app}${a.cidade ? " · " + a.cidade : ""}` }),
      el("label", {}, "O que foi resolvido (opcional)", nota), erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          const bt = e.currentTarget; bt.disabled = true;
          try { await App.u.rpc("resolver_aviso_rapido", { p_id: a.id, p_nota: nota.value.trim() || null }); d.close(); App.u.toast("Marcado como resolvido."); App.carregar(); }
          catch (err) { bt.disabled = false; erro.textContent = App.u.msgErro(err); erro.hidden = false; }
        } }, "Marcar como resolvido"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  // 009d: "Acontecendo agora" = pedidos de ajuda, avisos gerais, passagens de turno (js/agora.js) e as pendências
  function renderRapidos() {
    const box = $("#inicio-rapidos"), lista = (S.resumo?.avisos_rapidos || []).filter((a) => a.tipo === "pendencia");
    const ag = App.agora?.cartoes() || { ajudas: [], avisos: [], passagens: [] };
    const todos = [...ag.ajudas, ...ag.avisos, ...ag.passagens, ...lista.map(cartaoPendencia)];
    box.hidden = !todos.length;
    box.replaceChildren(...(todos.length ? [el("h2", { class: "rapidos-titulo" }, "Acontecendo agora ", el("span", { class: "count alert", text: todos.length })),
      el("div", { class: "rapidos-lista" }, todos)] : []));
  }
  function cartaoPendencia(a) {
    return el("article", { class: "rapido", "data-tipo": "pendencia" },
        el("div", { class: "rapido-tipo", text: a.titulo }),
        el("div", { class: "rapido-quem" }, App.abrirFicha ? el("button", { class: "link-ficha", type: "button", onclick: () => App.abrirFicha(a.id_app) }, a.nome || "ID " + a.id_app) : (a.nome || "ID " + a.id_app),
          a.nome ? el("span", { class: "mono meta", text: " " + a.id_app }) : null),
        el("div", { class: "meta", text: `${a.cidade ? a.cidade + " · " : ""}há ${App.u.duracao(a.criado_em).txt} · por ${a.criado_por_nome || "—"}` }),
        el("button", { class: "btn small", type: "button", onclick: () => resolverRapido(a) }, "Marcar como resolvido"));
  }

  // 009d: acordos com parceiros que venceram: bem chamativo, no topo, até alguém fazer o ajuste
  function renderAcordos() {
    const lista = S.resumo?.acordos_vencidos || [];
    $("#inicio-acordos").replaceChildren(...lista.map((a) => el("div", { class: "acordo-vencido", role: "alert" },
      el("span", { class: "acordo-icone" }, App.ic("alerta")),
      el("div", { class: "acordo-corpo" },
        el("b", { text: a.dias === 0 ? `Acordo vence hoje: fazer o ajuste · ${a.estabelecimento} (${a.cidade})` : `Acordo vencido há ${-a.dias} dia(s): fazer o ajuste · ${a.estabelecimento} (${a.cidade})` }),
        el("span", { class: "rapido-texto", text: a.acordo })),
      el("button", { class: "btn", type: "button", onclick: () => App.ajustarAcordo?.(a) }, "Ajuste feito"))));
  }

  function render() {
    renderAcordos();
    App.noticias?.render();
    renderRapidos();
    const r = S.resumo, a = r?.ativacao, b = r?.bloqueios, at = r?.atividades;
    $("#ola").textContent = `Olá, ${S.me.nome.split(" ")[0]}!`;
    $("#inicio-dia").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: App.u.FUSO, weekday: "long", day: "numeric", month: "long" }).format(new Date()).replace(/^./, (x) => x.toUpperCase());

    // ---------- 009y1 parte 2 (AP-10): o que precisa de você agora, em linhas, do mais urgente ao resto ----------
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const precisa = [
      b?.tratativas_atrasadas && staffBloq() ? { n: b.tratativas_atrasadas, txt: plural(b.tratativas_atrasadas, "tratativa atrasada", "tratativas atrasadas"), href: "#bloqueios/tratativas", urgente: true, chave: "atrasadas" } : null,
      at?.para_aceitar ? { n: at.para_aceitar, txt: plural(at.para_aceitar, "tarefa pedida para você", "tarefas pedidas para você"), href: "#atividades/pendencias", chave: "pedidas" } : null,
      at?.minhas_em_andamento ? { n: at.minhas_em_andamento, txt: plural(at.minhas_em_andamento, "tarefa com você em andamento", "tarefas com você em andamento"), href: "#atividades/pendencias", chave: "comigo" } : null,
      staffBloq() && b?.tratativas_pendentes ? { n: b.tratativas_pendentes, txt: plural(b.tratativas_pendentes, S.me.papel_bloqueios === "moderador" ? "tratativa pendente" : "tratativa com você", S.me.papel_bloqueios === "moderador" ? "tratativas pendentes" : "tratativas com você"), href: "#bloqueios/tratativas", chave: "tratativas" } : null,
      staffAtiv() && a?.equipe_aguardando_analise ? { n: a.equipe_aguardando_analise, txt: plural(a.equipe_aguardando_analise, "cadastro aguardando análise", "cadastros aguardando análise"), href: "#ativacao/pendentes", chave: "cadastros" } : null,
      r?.financeiro_pendentes ? { n: r.financeiro_pendentes, txt: plural(r.financeiro_pendentes, "lançamento seu ainda não lançado no sistema", "lançamentos seus ainda não lançados no sistema"), href: "#financeiro/lancamentos/pendentes", chave: "lancamentos" } : null,
      at?.abertas_para_pegar ? { n: at.abertas_para_pegar, txt: plural(at.abertas_para_pegar, "tarefa aberta para a equipe", "tarefas abertas para a equipe"), href: "#atividades/sugeridas", leve: true, chave: "abertas" } : null,
    ].filter(Boolean);
    // 009y1f (pedido do usuário): "Ver" abre uma tira logo abaixo com a prévia do que é preciso fazer (até 5), sem sair da tela
    $("#precisa-lista").replaceChildren(...(precisa.length ? precisa.map((x) => {
      const aberta = tiraAberta === x.chave;
      return el("li", { class: [x.urgente ? "urgente" : x.leve ? "leve" : null, aberta ? "aberta" : null].filter(Boolean).join(" ") || null, "data-chave": x.chave },
        el("b", { class: "precisa-n", text: String(x.n) }), el("span", { text: x.txt.replace(/^\d+ /, "") }),
        el("button", { class: "btn small" + (x.leve || aberta ? "" : " primary"), type: "button", "aria-expanded": aberta ? "true" : "false",
          onclick: () => { tiraAberta = aberta ? null : x.chave; if (!aberta) buscarTira(x.chave); App.render(); } }, aberta ? "Fechar" : "Ver"),
        aberta ? tira(x) : null);
    }) : [el("li", { class: "nada" }, el("span", { text: "Nada esperando por você agora." }))]));
    renderPassos();
    $("#inicio-acoes").replaceChildren(...(App.agora?.botoes() || []));

    // ---------- funções ----------
    const fn = [
      funcao({ id: "fn-ativacao", href: "#ativacao/novo", icone: "ativacao", cor: "f-ativ", titulo: "Nova ativação",
        texto: "Enviar o cadastro de um entregador para aprovação.",
        vivo: a ? (staffAtiv() ? `${a.equipe_aguardando_analise ?? a.aguardando_analise} aguardando análise` : `${a.meus_aguardando_analise} ${a.meus_aguardando_analise === 1 ? "seu" : "seus"} em análise`) : null }),
      S.me.papel_bloqueios ? funcao({ id: "fn-bloqueio", href: "#bloqueios/novo", icone: "bloqueio", cor: "f-bloq", titulo: "Nova restrição",
        texto: "Registrar uma restrição ou uma infração leve, com a punição calculada.",
        vivo: b ? `${b.equipe_bloqueados_agora ?? b.meus_bloqueados_agora ?? 0} com restrição agora` : null }) : null,
      S.me.papel_bloqueios ? funcao({ id: "card-entregadores", href: "#entregadores/cadastrar", icone: "entregador", cor: "f-ent", titulo: "Cadastrar entregador",
        texto: "Criar a ficha com ID, nome e cidade, sem ativar nem aplicar restrição." }) : null,
      funcao({ id: "fn-parceiro", href: "#parceiros/novo", icone: "parceiro", cor: "f-par", titulo: "Ativar parceiro",
        texto: "Registrar um estabelecimento que você ativou." }),
      funcao({ id: "fn-calculadora", href: "#ferramentas/calculadora", icone: "calculadora", cor: "f-fer", titulo: "Calculadora de bairro",
        texto: "Bairro cobrado errado? Veja quanto falta pagar ao entregador." }),
      funcao({ id: "fn-adicional", href: "#financeiro/adicional", icone: "adicional", cor: "f-fin", titulo: "Registrar adicional",
        texto: "Valor combinado com o entregador além da entrega.",
        vivo: r?.financeiro_pendentes ? `${r.financeiro_pendentes} seu(s) ainda não lançado(s)` : null }),
      funcao({ id: "fn-sugerir", href: "#atividades/sugeridas", icone: "tarefa", cor: "f-sug", titulo: "Nova tarefa", onclick: abrirSugerir,
        texto: "Pedir algo para alguém ou registrar o que você já fez.",
        vivo: at ? `${at.equipe_abertas} abertas na equipe` : null }),
      funcao({ id: "card-registros", href: "#avisos/equipe", icone: "registros", cor: "f-reg", titulo: "Registros",
        texto: "Tudo o que a equipe fez, em ordem: quem, o quê e quando." }),
    ].filter(Boolean);
    $("#inicio-funcoes").replaceChildren(...fn);

    // ---------- números (mais discretos) ----------
    const cards = [];
    cards.push(el("a", { class: "modulo-card", href: "#ativacao/" + (staffAtiv() ? "pendentes" : "historico"), id: "card-ativacao" },
      el("h3", { text: "Ativação de entregadores" }),
      el("div", { class: "numeros" }, staffAtiv()
        ? [numero(a?.equipe_aguardando_analise, "aguardando análise", a ? `${a.meus_aguardando_analise} enviados por você` : null),
           numero(a?.equipe_aguardando_contato, "aguardando novo contato")]
        : [numero(a?.meus_aguardando_analise, "seus aguardando análise", naEquipe(a?.equipe_aguardando_analise)),
           numero(a?.meus_aguardando_contato, "seus aguardando novo contato", naEquipe(a?.equipe_aguardando_contato))])));
    if (S.me.papel_bloqueios) {
      cards.push(el("a", { class: "modulo-card bloq", href: "#bloqueios/" + (staffBloq() ? "tratativas" : "historico"), id: "card-bloqueios" },
        el("h3", { text: "Restrições" }),
        el("div", { class: "numeros" }, staffBloq()
          ? [numero(b?.equipe_bloqueados_agora, "com restrição agora", b ? `${b.meus_bloqueados_agora} registrados por você` : null),
             numero(b?.tratativas_pendentes, S.me.papel_bloqueios === "moderador" ? "tratativas pendentes" : "tratativas para você", naEquipe(b?.equipe_tratativas_pendentes)),
             b?.tratativas_atrasadas ? numero(b.tratativas_atrasadas, `atrasadas (mais de ${r.prazo_tratativa_horas ?? 32} h)`, null, true) : null,
             b?.atencao ? numero(b.atencao, "entregadores de atenção") : null]
          : [numero(b?.meus_bloqueados_agora, "seus entregadores com restrição agora", naEquipe(b?.equipe_bloqueados_agora)),
             numero(b?.tratativas_pendentes, "suas tratativas em andamento", naEquipe(b?.equipe_tratativas_pendentes)),
             b?.atencao ? numero(b.atencao, "entregadores de atenção") : null])));
    }
    cards.push(el("a", { class: "modulo-card ativ", href: "#atividades/pendencias", id: "card-atividades" },
      el("h3", { text: "Atividades" }),
      el("div", { class: "numeros" },
        numero(App.modulos.atividades?.totalPendencias?.(), "pendências"),
        numero(at?.para_aceitar, "sugeridas esperando aceite"),
        numero(S.notif?.nao_lidas, "avisos novos"))));
    $("#modulos-grid").replaceChildren(...cards);

    // 009w (pedido do usuário): no lugar da faixa, só um botão discreto que abre o histórico ("O que há de novo")
    const nv = App.novidades;
    $("#inicio-novidades").replaceChildren(nv ? el("button", { class: "btn small historico-versoes", type: "button", onclick: () => nv.mostrar(),
      title: `Última: ${nv.NOVIDADES.tema}` }, App.ic("tempo"), "Histórico de atualizações") : "");

    // 009x5: um lembrete discreto das cidades sem responsável (os avisos delas vão para todos os moderadores)
    const sr = I.semResp?.cidades?.length || 0;
    $("#inicio-cidades").replaceChildren(sr ? el("p", { class: "meta lembrete-cidades" }, `${sr} ${sr === 1 ? "cidade está" : "cidades estão"} sem responsável: os avisos delas vão para todos os moderadores. `,
      el("a", { href: "#avisos/para-mim", onclick: () => { const b = document.querySelector("#av-cidades"); if (b) b.dataset.aberto = "1"; } }, "Ver e pedir uma")) : "");
  }
  // ---------- 009y1 parte 2 (A15-03): primeiros passos de quem entrou na equipe há menos de 14 dias ----------
  // Marcados à mão (clicar no passo marca como feito); somem quando todos estão feitos, em 14 dias ou em "Não preciso".
  const PASSOS = [
    ["cadastro", "Enviar um cadastro de entregador", "#ativacao/novo", () => true],
    ["busca", "Abrir a ficha de um entregador pela busca do topo", null, () => !!S.me.papel_bloqueios],
    ["adicional", "Registrar um adicional", "#financeiro/adicional", () => true],
    ["tarefa", "Pegar uma tarefa na Minha fila", "#atividades/pendencias", () => true],
    ["avisos", "Escolher o que você recebe em Avisos", "#avisos/para-mim", () => true],
    ["analisar", "Analisar um cadastro pendente", "#ativacao/pendentes", () => staffAtiv()],
    ["tratativa", "Concluir uma tratativa", "#bloqueios/tratativas", () => staffBloq()],
  ];
  const lerPassos = () => { try { return JSON.parse(localStorage.getItem("comunique-passos") || "{}"); } catch (_) { return {}; } };
  const gravarPassos = (v) => { try { localStorage.setItem("comunique-passos", JSON.stringify(v)); } catch (_) {} };
  function renderPassos() {
    const box = $("#inicio-passos"), desde = S.me?.liberado_em ? new Date(S.me.liberado_em) : null;
    const st = lerPassos(), meus = PASSOS.filter((p) => p[3]());
    const feitos = meus.filter(([k]) => st[k]).length;
    if (!desde || Date.now() - desde > 14 * 86400000 || st.dispensado || feitos === meus.length) return box.replaceChildren();
    const marcar = (k) => { const v = lerPassos(); v[k] = true; gravarPassos(v); renderPassos(); };
    box.replaceChildren(el("details", { class: "passos panel" },
      el("summary", {}, el("b", { text: `Seus primeiros passos: ${feitos} de ${meus.length}` }), el("span", { class: "meta", text: " · Continuar" })),
      el("ol", { class: "passos-lista" }, meus.map(([k, txt, href]) => el("li", { class: st[k] ? "feito" : null },
        href ? el("a", { href, onclick: () => marcar(k) }, txt) : el("button", { type: "button", class: "btn link", onclick: () => { marcar(k); $("#q-topo")?.focus(); } }, txt),
        st[k] ? el("span", { class: "meta", text: " · feito" }) : null))),
      el("button", { type: "button", class: "btn link", onclick: () => { const v = lerPassos(); v.dispensado = true; gravarPassos(v); renderPassos(); } }, "Não preciso")));
  }

  // 009x5: cidades sem responsável, no máximo a cada 5 min
  const I = { semResp: null, em: 0 };
  async function carregarCidades() {
    if (Date.now() - I.em < 300000) return;
    I.em = Date.now();
    try { I.semResp = await App.u.rpc("cidades_sem_responsavel"); } catch (_) { I.em = 0; }
  }

  App.modulo({
    id: "inicio", nome: "Início",
    abas: [{ id: "inicio", nome: "Início", secao: "v-inicio" }],
    carregar: () => Promise.all([App.noticias?.carregar(), carregarCidades()]),   // 009f: notícias rápidas só quando a tela inicial está aberta
    render,
  });
})();
