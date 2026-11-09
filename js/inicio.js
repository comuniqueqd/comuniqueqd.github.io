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
      box.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  }

  // botão de função: ícone, nome, para que serve e uma linha viva (o que está acontecendo agora)
  const funcao = ({ id, href, icone, titulo, texto, vivo, cor, onclick }) =>
    el("a", { class: "funcao " + cor, href, id, onclick },
      el("span", { class: "funcao-icone", "aria-hidden": "true", text: icone }),
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
      el("span", { class: "acordo-icone", "aria-hidden": "true", text: "⚠️" }),
      el("div", { class: "acordo-corpo" },
        el("b", { text: a.dias === 0 ? `Acordo vence hoje: fazer o ajuste · ${a.estabelecimento} (${a.cidade})` : `Acordo vencido há ${-a.dias} dia(s): fazer o ajuste · ${a.estabelecimento} (${a.cidade})` }),
        el("span", { class: "rapido-texto", text: a.acordo })),
      el("button", { class: "btn", type: "button", onclick: () => App.ajustarAcordo?.(a) }, "Ajuste feito"))));
  }

  function render() {
    renderAcordos();
    renderRapidos();
    const r = S.resumo, a = r?.ativacao, b = r?.bloqueios, at = r?.atividades;
    $("#ola").textContent = `Olá, ${S.me.nome.split(" ")[0]}!`;
    $("#inicio-acoes").replaceChildren(...(App.agora?.botoes() || []));

    // ---------- funções ----------
    const fn = [
      funcao({ id: "fn-ativacao", href: "#ativacao/novo", icone: "📝", cor: "f-ativ", titulo: "Nova ativação",
        texto: "Enviar o cadastro de um entregador para aprovação.",
        vivo: a ? (staffAtiv() ? `${a.equipe_aguardando_analise ?? a.aguardando_analise} aguardando análise` : `${a.meus_aguardando_analise} ${a.meus_aguardando_analise === 1 ? "seu" : "seus"} em análise`) : null }),
      S.me.papel_bloqueios ? funcao({ id: "fn-bloqueio", href: "#bloqueios/novo", icone: "⛔", cor: "f-bloq", titulo: "Novo bloqueio",
        texto: "Registrar um bloqueio ou uma infração leve, com a punição calculada.",
        vivo: b ? `${b.equipe_bloqueados_agora ?? b.meus_bloqueados_agora ?? 0} bloqueados agora` : null }) : null,
      S.me.papel_bloqueios ? funcao({ id: "card-entregadores", href: "#entregadores/cadastrar", icone: "🪪", cor: "f-ent", titulo: "Cadastrar entregador",
        texto: "Criar a ficha com ID, nome e cidade, sem ativar nem bloquear." }) : null,
      funcao({ id: "fn-calculadora", href: "#ferramentas/calculadora", icone: "🧮", cor: "f-fer", titulo: "Calculadora de bairro",
        texto: "Bairro cobrado errado? Veja quanto falta pagar ao entregador." }),
      funcao({ id: "fn-adicional", href: "#financeiro/adicional", icone: "💰", cor: "f-fin", titulo: "Registrar adicional",
        texto: "Valor combinado com o entregador além da entrega.",
        vivo: r?.financeiro_pendentes ? `${r.financeiro_pendentes} seu(s) ainda não lançado(s)` : null }),
      funcao({ id: "fn-sugerir", href: "#atividades/sugeridas", icone: "💡", cor: "f-sug", titulo: "Nova tarefa", onclick: abrirSugerir,
        texto: "Pedir algo para alguém ou registrar o que você já fez.",
        vivo: at ? `${at.equipe_abertas} abertas na equipe` : null }),
      funcao({ id: "card-registros", href: "#registros", icone: "🗂️", cor: "f-reg", titulo: "Registros",
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
        el("h3", { text: "Bloqueios" }),
        el("div", { class: "numeros" }, staffBloq()
          ? [numero(b?.equipe_bloqueados_agora, "bloqueados agora", b ? `${b.meus_bloqueados_agora} registrados por você` : null),
             numero(b?.tratativas_pendentes, S.me.papel_bloqueios === "moderador" ? "tratativas pendentes" : "tratativas para você", naEquipe(b?.equipe_tratativas_pendentes)),
             b?.tratativas_atrasadas ? numero(b.tratativas_atrasadas, `atrasadas (mais de ${r.prazo_tratativa_horas ?? 32} h)`, null, true) : null,
             b?.atencao ? numero(b.atencao, "entregadores de atenção") : null]
          : [numero(b?.meus_bloqueados_agora, "seus bloqueados agora", naEquipe(b?.equipe_bloqueados_agora)),
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

    // faixa da versão nova: os destaques e o botão para rever a janela "O que há de novo"
    const nv = App.novidades;
    $("#inicio-novidades").replaceChildren(nv ? el("div", { class: "faixa-novidades" },
      el("b", { text: `Novidades: ${nv.NOVIDADES.tema}` }),
      el("span", { text: nv.NOVIDADES.versoes[0].itens.map(([t]) => t).join(" · ") + ` · e mais: ${nv.NOVIDADES.versoes.slice(1).map((v) => v.versao).join(" e ")}` }),
      el("button", { class: "btn small", type: "button", onclick: () => nv.mostrar() }, "Ver o que há de novo")) : "");
  }

  App.modulo({
    id: "inicio", nome: "Início",
    abas: [{ id: "inicio", nome: "Início", secao: "v-inicio" }],
    render,
  });
})();
