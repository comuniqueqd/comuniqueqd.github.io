// "Acontecendo agora" (009d): pedir ajuda, aviso geral e passagem de turno.
// Os cartões ficam na tela inicial (js/inicio.js desenha com App.agora.cartoes()); as janelas e o
// lembrete das 18h (faixa em qualquer tela, para quem ainda não passou o turno hoje) ficam aqui.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, rpc, msgErro, toast, janela } = App.u;
  const S = App.S;
  const CATEGORIAS = [["monitoramento", "Operação – Monitoramento"], ["suporte_crisp", "Operação – Suporte (Crisp)"], ["suporte_blip", "Operação – Suporte (Blip)"]];
  const DURACOES = [[0.5, "30 min"], [1, "1 h"], [2, "2 h"], [4, "4 h"], [8, "8 h"], [12, "12 h"]];
  const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const minutosAte = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 60000));
  const souModerador = () => S.me?.papel === "moderador" || S.me?.papel_bloqueios === "moderador";
  const erroEl = () => el("p", { class: "warn-msg", role: "alert", hidden: true });

  // botão que chama a função, mostra o erro e recarrega
  function acao(texto, fn, { classe = "btn small", ok, erro } = {}) {
    return el("button", { class: classe, type: "button", onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await fn(); if (ok) toast(ok); App.carregar(); }
      catch (err) { b.disabled = false; if (erro) { erro.textContent = msgErro(err); erro.hidden = false; } else toast(msgErro(err)); }
    } }, texto);
  }

  // ---------- pedir ajuda ----------
  function pedirAjuda() {
    const radios = CATEGORIAS.map(([v, t], i) => {
      const r = el("input", { type: "radio", name: "ag-categoria", value: v }); if (i === 0) r.checked = true;
      return el("label", { class: "marcar" }, r, t);
    });
    const texto = el("textarea", { id: "ag-ajuda-texto", rows: 3, maxlength: 500, placeholder: "Ex.: fila no Crisp com 12 conversas esperando" });
    const erro = erroEl();
    const d = janela("Pedir ajuda agora",
      el("p", { class: "meta", style: "margin-top:0", text: "Aparece na tela inicial de toda a equipe, com som, por 10 minutos ou até alguém aceitar." }),
      el("fieldset", { class: "opcoes-col" }, el("legend", { text: "Do que é a ajuda?" }), ...radios),
      el("label", {}, "O que está acontecendo (opcional)", texto), erro,
      el("div", { class: "actions" },
        acao("🆘 Pedir ajuda", async () => {
          await rpc("pedir_ajuda", { p_categoria: d.querySelector("input[name=ag-categoria]:checked").value,
            p_texto: texto.value.trim() || null });
          d.close();
        }, { classe: "btn primary", ok: "Pedido enviado para a equipe.", erro }),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    d.id = "janela-ajuda";
    setTimeout(() => texto.focus(), 30);
  }

  // ---------- aviso geral ----------
  function avisoGeral() {
    const texto = el("textarea", { id: "ag-aviso-texto", rows: 4, maxlength: 500, placeholder: "Ex.: o app dos entregadores está fora do ar em Lagarto; avisem quem ligar." });
    let horas = 2;
    const chips = el("div", { class: "chips-linha" }, DURACOES.map(([h, t]) => el("button", { class: "chip", type: "button", "data-horas": h, "aria-pressed": String(h === horas),
      onclick: (e) => { horas = h; chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); } }, t)));
    const erro = erroEl();
    const d = janela("Aviso geral",
      el("p", { class: "meta", style: "margin-top:0", text: "Fica na tela inicial de todos pelo tempo que você escolher (até 12 h). Você pode encerrar antes." }),
      el("label", {}, "Aviso", texto),
      el("div", {}, el("span", { class: "meta", text: "Fica na tela por" }), chips), erro,
      el("div", { class: "actions" },
        acao("📢 Publicar aviso", async () => {
          if (!texto.value.trim()) throw new Error("Escreva o aviso.");
          await rpc("criar_aviso_geral", { p_texto: texto.value.trim(), p_horas: horas });
          d.close();
        }, { classe: "btn primary", ok: "Aviso publicado para a equipe.", erro }),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    d.id = "janela-aviso";
    setTimeout(() => texto.focus(), 30);
  }

  // ---------- passagem de turno ----------
  async function passarTurno() {
    let p;
    try { p = await rpc("panorama_turno"); } catch (e) { return toast(msgErro(e)); }
    const outros = (S.pessoas || []).filter((x) => x.id !== S.me.id);
    const itens = [...p.tarefas, ...p.atividades];
    const linhas = itens.map((it) => {
      const sel = el("select", { "aria-label": "O que fazer com " + it.titulo },
        el("option", { value: "manter", text: "Manter comigo" }),
        el("option", { value: "abrir", text: it.tipo === "tarefa" ? "Deixar para o responsável/moderadores" : "Devolver para a equipe (aberta)" }),
        el("optgroup", { label: "Passar para" }, outros.map((x) => el("option", { value: "p:" + x.id, text: x.nome }))));
      sel._item = it;
      return el("li", { class: "turno-item" },
        el("div", {}, el("b", { text: it.titulo }), it.atrasada ? el("span", { class: "tag warn", text: "atrasada" }) : null,
          el("span", { class: "meta", text: ` · ${it.tipo === "tarefa" ? "tratativa" : "atividade"} desde ${App.u.dt(it.criada_em)}` })), sel);
    });
    const nums = [[p.ajudas_abertas, "pedido(s) de ajuda aberto(s)"], [p.pendencias, "pendência(s) de prestação de contas"],
      [p.liberam_6h, "saem da restrição nas próximas 6 h"], [p.tratativas_equipe, "tratativas pendentes na equipe"],
      [p.atrasadas_equipe, "atrasadas"], [p.adicionais_meus, "adicional(is) seu(s) não lançado(s)"]];
    const texto = el("textarea", { id: "ag-turno-texto", rows: 4, maxlength: 1500, placeholder: "O que quem entra precisa saber: casos em andamento, combinados, cuidado com…" });
    const erro = erroEl();
    const d = janela("Passar o turno",
      el("div", { class: "turno-panorama" }, el("b", { text: "Agora na equipe: " }), nums.map(([v, t]) => `${v ?? 0} ${t}`).join(" · ")),
      el("h4", { text: itens.length ? `Com você (${itens.length})` : "Nada pendente com você" }),
      itens.length ? el("ul", { class: "turno-itens" }, linhas) : el("p", { class: "meta", text: "Nenhuma tratativa ou atividade aceita está com você." }),
      el("label", {}, "Recado para quem entra", texto), erro,
      el("div", { class: "actions" },
        acao("🔁 Passar o turno", async () => {
          const p_itens = linhas.map((li) => {
            const s = li.querySelector("select"), v = s.value, it = s._item;
            return { tipo: it.tipo, id: it.id, titulo: it.titulo, acao: v.startsWith("p:") ? "passar" : v, para: v.startsWith("p:") ? v.slice(2) : null };
          });
          await rpc("passar_turno", { p_texto: texto.value.trim() || null, p_itens: p_itens.length ? p_itens : null });
          try { sessionStorage.removeItem("comunique-turno-depois"); } catch (_) {}
          d.close();
        }, { classe: "btn primary", ok: "Turno passado. Bom descanso!", erro }),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    d.id = "janela-turno";
  }

  // ---------- cartões de "Acontecendo agora" ----------
  const linkOuProtocolo = (l) => !l ? null : /^https?:\/\//i.test(l)
    ? el("a", { href: l, target: "_blank", rel: "noopener", text: l.length > 60 ? l.slice(0, 57) + "…" : l })
    : el("span", { class: "mono", text: l });
  const ajudaVisivel = (a) => a.meu || a.aceito_por_mim || a.aceito_por_nome || a.para_moderadores || (a.expira_em && new Date(a.expira_em) > Date.now());

  function cartaoAjuda(a) {
    const expirado = !a.aceito_por_nome && (a.expirado || new Date(a.expira_em) <= Date.now());
    const erro = erroEl();
    let situacao, botoes = [];
    if (a.aceito_por_nome) {
      situacao = a.meu ? `🤝 ${a.aceito_por_nome} vai te ajudar` : a.aceito_por_mim ? `🤝 Você está ajudando ${a.criado_por_nome}` : `🤝 ${a.aceito_por_nome} está ajudando`;
      if (a.meu || a.aceito_por_mim) botoes = [acao("Resolvido", () => rpc("resolver_aviso_rapido", { p_id: a.id, p_nota: null }), { classe: "btn small primary", ok: "Pedido de ajuda resolvido.", erro })];
    } else if (a.meu) {
      if (a.para_moderadores) {
        situacao = "Enviado para os moderadores, esperando alguém pegar";
        botoes = [acao("Cancelar pedido", () => rpc("encerrar_aviso_rapido", { p_id: a.id }), { ok: "Pedido cancelado.", erro })];
      } else if (expirado) {
        situacao = "Ninguém pegou em 10 minutos";
        botoes = [acao("Pedir de novo", () => rpc("renovar_ajuda", { p_id: a.id, p_moderadores: false }), { classe: "btn small primary", ok: "Pedido reenviado para a equipe.", erro }),
          acao("Mandar para os moderadores", () => rpc("renovar_ajuda", { p_id: a.id, p_moderadores: true }), { ok: "Pedido enviado aos moderadores.", erro }),
          acao("Cancelar", () => rpc("encerrar_aviso_rapido", { p_id: a.id }), { classe: "btn small link", ok: "Pedido cancelado.", erro })];
      } else {
        situacao = `Seu pedido está aberto para a equipe · expira em ${minutosAte(a.expira_em)} min`;
        botoes = [acao("Cancelar pedido", () => rpc("encerrar_aviso_rapido", { p_id: a.id }), { ok: "Pedido cancelado.", erro })];
      }
    } else {
      situacao = a.para_moderadores ? `${a.criado_por_nome} precisa de ajuda (ninguém pegou; enviado aos moderadores)`
        : `${a.criado_por_nome} precisa de ajuda · ${minutosAte(a.expira_em)} min para alguém pegar`;
      botoes = [acao("🙋 Eu ajudo", async () => { await rpc("aceitar_ajuda", { p_id: a.id }); App.som?.parar(); }, { classe: "btn small primary", ok: "Você aceitou ajudar. Combine com quem pediu.", erro })];
    }
    return el("article", { class: "rapido ajuda" + (a.aceito_por_nome ? " aceita" : expirado ? " expirada" : "") , "data-tipo": "ajuda" },
      el("div", { class: "rapido-tipo", text: "🆘 Pedido de ajuda · " + a.titulo }),
      el("div", { class: "rapido-quem", text: situacao }),
      a.texto ? el("div", { class: "rapido-texto", text: a.texto }) : null,
      a.link ? el("div", { class: "meta" }, "Link/protocolo: ", linkOuProtocolo(a.link)) : null,
      el("div", { class: "meta", text: `pedido às ${hora(a.criado_em)}` }),
      botoes.length ? el("div", { class: "actions" }, botoes) : null, erro);
  }

  function cartaoAviso(a) {
    return el("article", { class: "rapido aviso-geral", "data-tipo": "aviso" },
      el("div", { class: "rapido-tipo", text: "📢 Aviso geral" }),
      el("div", { class: "rapido-texto", text: a.texto }),
      el("div", { class: "meta", text: `${a.meu ? "seu" : "de " + (a.criado_por_nome || "—")} · às ${hora(a.criado_em)} · fica até ${hora(a.expira_em)}` }),
      a.meu || souModerador() ? el("div", { class: "actions" }, acao("Encerrar aviso", () => rpc("encerrar_aviso_rapido", { p_id: a.id }), { classe: "btn small link", ok: "Aviso encerrado." })) : null);
  }

  const ACAO = { passar: "passou para", abrir: "deixou aberta", manter: "manteve com ela/ele" };
  function cartaoPassagem(p) {
    const pano = p.panorama || {};
    return el("article", { class: "rapido passagem", "data-tipo": "turno" },
      el("div", { class: "rapido-tipo", text: `🔁 Passagem de turno de ${p.de_nome || "—"} · ${hora(p.criada_em)}` }),
      p.texto ? el("div", { class: "rapido-texto", text: p.texto }) : null,
      (p.itens || []).length ? el("ul", { class: "passagem-itens" }, p.itens.map((it) =>
        el("li", {}, el("b", { text: it.acao === "passar" ? `Passou para ${it.para_nome}` : it.acao === "abrir" ? "Deixou aberta" : "Manteve" }), ": " + (it.titulo || "")))) : null,
      el("div", { class: "meta", text: `Na hora: ${pano.tratativas_equipe ?? 0} tratativa(s) pendente(s) · ${pano.atrasadas_equipe ?? 0} atrasada(s) · ${pano.liberam_6h ?? 0} saem da restrição em 6 h · ${pano.pendencias ?? 0} pendência(s)` }),
      el("div", { class: "actions" }, acao("Li", () => rpc("ler_passagem", { p_id: p.id }), { classe: "btn small" })));
  }

  // cartões na ordem: ajuda, aviso geral, passagem de turno, pendências (essas o js/inicio.js desenha)
  function cartoes() {
    const lista = (S.resumo?.avisos_rapidos || []);
    return {
      ajudas: lista.filter((a) => a.tipo === "ajuda" && ajudaVisivel(a)).map(cartaoAjuda),
      avisos: lista.filter((a) => a.tipo === "aviso" && new Date(a.expira_em) > Date.now()).map(cartaoAviso),
      passagens: (S.resumo?.passagens || []).map(cartaoPassagem),
    };
  }

  // botões pequenos ao lado do "Olá"
  const botoes = () => [
    el("button", { class: "btn small acao-agora ajuda", type: "button", id: "b-pedir-ajuda", onclick: pedirAjuda }, "🆘 Pedir ajuda"),
    el("button", { class: "btn small acao-agora", type: "button", id: "b-aviso-geral", onclick: avisoGeral }, "📢 Aviso geral"),
    el("button", { class: "btn small acao-agora", type: "button", id: "b-passar-turno", onclick: passarTurno }, "🔁 Passar o turno"),
  ];

  // ---------- lembrete das 18h ----------
  // das 17h30 às 18h59 (horário de Brasília), para quem ainda não passou o turno hoje; "Depois" esconde por 30 min.
  function horaBrasilia() {
    const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const g = (t) => Number(p.find((x) => x.type === t)?.value);
    return g("hour") * 60 + g("minute");
  }
  App.agora_relogio = horaBrasilia;  // o e2e troca para testar o lembrete
  function lembrete() {
    let depois = 0;
    try { depois = Number(sessionStorage.getItem("comunique-turno-depois") || 0); } catch (_) {}
    const m = App.agora_relogio();
    const mostrar = S.me && S.resumo && !S.resumo.minha_passagem_hoje && m >= 17 * 60 + 30 && m < 19 * 60 && Date.now() > depois;
    const atual = $("#lembrete-turno");
    if (!mostrar) { atual?.remove(); return; }
    if (atual) return;
    document.body.append(el("div", { class: "aviso-versao lembrete-turno", id: "lembrete-turno", role: "status" },
      el("span", { text: "🔁 Chegando as 18h: antes de sair, passe o turno para quem entra." }),
      el("button", { class: "btn primary small", type: "button", onclick: () => passarTurno() }, "Passar o turno agora"),
      el("button", { class: "btn link", type: "button", onclick: (e) => {
        try { sessionStorage.setItem("comunique-turno-depois", String(Date.now() + 30 * 60000)); } catch (_) {}
        e.currentTarget.parentElement.remove();
      } }, "Depois")));
  }

  // depois de cada desenho: lembrete e o som do pedido de ajuda (quando o tempo real não chegou)
  const renderOriginal = App.render;
  App.render = function () {
    renderOriginal.apply(this, arguments);
    try { lembrete(); App.som?.conferir(); } catch (e) { console.error(e); }
  };

  App.agora = { cartoes, botoes, pedirAjuda, avisoGeral, passarTurno, lembrete };
})();
