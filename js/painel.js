// Painel das tarefas (009d3), na aba Atividades → Painel:
// - Suas metas (só pessoais, em teste): cada um cria as suas; o progresso conta sozinho.
// - O agora, o período, por tipo, por cidade, o mapa dia × hora e as pessoas (moderador vê todos;
//   os outros, só a própria linha: "cada um vê os próprios números como a liderança vê").
// - Revisão de qualidade (moderadores): sorteia tarefas concluídas para conferir.
// - Placar (só o administrador final).
// E as tarefas que se repetem (recorrentes), no fim da aba Tarefas (renderRecorrentes).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro } = App.u;
  const S = App.S;
  const P = { dias: 30, painel: null, metas: null, placar: null, amostra: null, rec: null, erro: null, editando: null };
  const souMod = () => S.me?.papel === "moderador" || S.me?.papel_bloqueios === "moderador";
  const pct = (v) => (v == null ? "—" : v + "%");
  const min = (v) => (v == null ? "—" : v < 60 ? `${v} min` : v < 1440 ? `${Math.round(v / 6) / 10} h`.replace(".", ",") : `${Math.round(v / 144) / 10} dias`.replace(".", ","));
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const FREQ = { diaria: "Todo dia", semanal: "Toda semana", mensal: "Todo mês" };
  const tabela = (cols, linhas, vazioTxt) => el("div", { class: "tablewrap" }, el("table", {},
    el("thead", {}, el("tr", {}, cols.map(([t, n]) => el("th", { class: n ? "num" : null, text: t })))),
    el("tbody", {}, linhas.length ? linhas : el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: vazioTxt })))));
  const quadro = (n, rotulo, alerta) => el("div", { class: "tile" + (alerta && n ? " hl2" : "") }, el("div", { class: "v", text: n ?? "—" }), el("div", { class: "k", text: rotulo }));

  async function carregar() {
    try {
      const [p, m, pl] = await Promise.all([rpc("painel_tarefas", { p_dias: P.dias }), rpc("minhas_metas"),
        S.me.admin_final ? rpc("placar_equipe", { p_dias: P.dias }) : null]);
      P.painel = p; P.metas = m; P.placar = pl; P.erro = null;
      if (!App.tarefasCampos.tipos()) await App.modulos.atividades.carregarTipos();
    } catch (e) { P.erro = msgErro(e); throw e; }
  }

  // ---------- metas ----------
  function blocoMetas() {
    const tipos = App.tarefasCampos.tipos()?.tipos || [];
    const selTipo = el("select", { id: "pn-meta-tipo", "aria-label": "Tipo de tarefa" }, el("option", { value: "", text: "Qualquer tarefa" }),
      ...tipos.map((t) => el("option", { value: t.tipo, text: `${t.icone || ""} ${t.nome}` })));
    const qtd = el("input", { id: "pn-meta-qtd", type: "number", min: 1, max: 500, value: 5, "aria-label": "Quantas" });
    const per = el("select", { id: "pn-meta-periodo", "aria-label": "Período" }, el("option", { value: "dia", text: "por dia" }), el("option", { value: "semana", text: "por semana (terça a segunda)" }));
    const lista = P.metas || [];
    return el("section", { class: "panel" },
      el("div", { class: "inicio-topo" }, el("h3", { style: "margin:0" }, "Suas metas ", el("span", { class: "tag opcional", text: "em teste" })),
        el("span", { class: "meta", text: "Só você vê. Contam as tarefas que você concluiu." })),
      lista.length ? el("div", { class: "metas-lista" }, lista.map((m) => {
        const p = Math.min(100, Math.round((m.feitas / m.quantidade) * 100));
        return el("div", { class: "meta-item" + (m.feitas >= m.quantidade ? " batida" : "") },
          el("div", { class: "inicio-topo" }, el("b", { text: `${m.icone} ${m.tipo_nome}` }),
            el("button", { class: "btn link", type: "button", "aria-label": "Apagar a meta", onclick: async () => { try { P.metas = await rpc("excluir_meta", { p_id: m.id }); App.render(); } catch (e) { toast(msgErro(e)); } } }, "✕")),
          el("div", { class: "progresso-tarefa" }, el("div", { class: "barra" }, el("span", { style: `width:${p}%` })),
            el("span", { class: "meta", text: `${m.feitas} de ${m.quantidade} ${m.periodo === "dia" ? "hoje" : "nesta semana"}${m.feitas >= m.quantidade ? " · batida 🎉" : ""}` })));
      })) : el("p", { class: "meta", text: "Nenhuma meta ainda. Que tal uma? Ex.: 5 tarefas por dia." }),
      el("form", { class: "actions", id: "pn-meta-form", onsubmit: async (e) => {
        e.preventDefault();
        try { P.metas = await rpc("salvar_meta", { p_tipo: selTipo.value || null, p_quantidade: Number(qtd.value), p_periodo: per.value }); toast("Meta criada."); App.render(); }
        catch (err) { toast(msgErro(err)); }
      } }, qtd, selTipo, per, el("button", { class: "btn small primary", type: "submit" }, "Criar meta")));
  }

  // ---------- revisão de qualidade (moderadores) ----------
  function blocoRevisao() {
    if (!souMod()) return null;
    const cards = (P.amostra || []).map((a) => {
      const com = el("input", { maxlength: 600, placeholder: "Comentário (obrigatório para “Ajustar”)", "aria-label": "Comentário da revisão" });
      const enviar = async (res, b) => {
        b.disabled = true;
        try { await rpc("revisar_qualidade", { p_id: a.id, p_resultado: res, p_comentario: com.value.trim() || null });
          P.amostra = P.amostra.filter((x) => x.id !== a.id); toast(res === "ok" ? "Revisada: ok." : "Pedido de ajuste enviado."); App.render(); }
        catch (e) { b.disabled = false; toast(msgErro(e)); }
      };
      return el("li", { class: "card", style: "list-style:none" },
        el("div", { class: "head" }, el("span", { class: "name" }, el("span", { class: "tag tipo", text: `${a.tipo_icone} ${a.tipo_nome}` }), a.titulo)),
        el("div", { class: "meta", text: `Feita por ${a.aceita_por_nome || a.concluida_por_nome || "—"} · concluída em ${dt(a.concluida_em)}${a.nota ? " · " + a.nota : ""}` }),
        el("div", { class: "actions" }, com,
          el("button", { class: "btn small approve", type: "button", onclick: (e) => enviar("ok", e.currentTarget) }, "✅ Está ok"),
          el("button", { class: "btn small", type: "button", onclick: (e) => enviar("ajustar", e.currentTarget) }, "✏️ Ajustar")));
    });
    return el("section", { class: "panel", id: "pn-revisao" },
      el("div", { class: "inicio-topo" }, el("h3", { style: "margin:0", text: "Revisão de qualidade" }),
        el("button", { class: "btn small", type: "button", id: "pn-sortear", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { P.amostra = await rpc("amostra_revisao", { p_qtd: 5 }); if (!P.amostra.length) toast("Nada para revisar: tudo dos últimos 14 dias já foi revisado."); App.render(); }
          catch (err) { toast(msgErro(err)); } finally { b.disabled = false; }
        } }, "🎲 Sortear 5 para revisar")),
      el("p", { class: "meta", text: "Tarefas concluídas nos últimos 14 dias, por outras pessoas, ainda sem revisão. Quem fez recebe o retorno." }),
      cards.length ? el("ul", { class: "queue", style: "padding:0;margin:0" }, cards) : null);
  }

  function render() {
    const box = $("#pn-conteudo");
    if (P.erro) return box.replaceChildren(el("p", { class: "warn-msg", text: P.erro }));
    const p = P.painel;
    if (!p) return box.replaceChildren(carregandoEl());
    document.querySelectorAll("[data-pn-dias]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.pnDias) === P.dias)));
    box.replaceChildren(
      blocoMetas(),
      el("section", { class: "panel" }, el("h3", { text: "Agora" }),
        el("div", { class: "tiles" }, quadro(p.agora.sem_dono, "sem ninguém", true), quadro(p.agora.em_andamento, "em andamento"),
          quadro(p.agora.aguardando, "aguardando terceiro"), quadro(p.agora.atrasadas, "atrasadas", true))),
      el("section", { class: "panel" }, el("h3", { text: `Nos últimos ${P.dias} dias` }),
        el("div", { class: "tiles" }, quadro(p.periodo.criadas, "pedidas"), quadro(p.periodo.registros, "registros do que já foi feito"),
          quadro(p.periodo.concluidas, "concluídas"), quadro(pct(p.periodo.no_prazo), "no prazo"),
          quadro(min(p.periodo.espera_min), "até alguém pegar (média)"), quadro(min(p.periodo.execucao_min), "para fazer (média, sem pausas)"))),
      el("div", { class: "two", style: "align-items:start" },
        el("section", { class: "panel" }, el("h3", { text: "Por tipo" }),
          tabela([["Tipo"], ["Abertas", 1], ["Concluídas", 1], ["No prazo", 1], ["Tempo médio", 1]],
            p.por_tipo.map((t) => el("tr", {}, el("td", { text: `${t.icone || ""} ${t.nome}` }), el("td", { class: "num", text: t.abertas }), el("td", { class: "num", text: t.concluidas }),
              el("td", { class: "num", text: pct(t.no_prazo) }), el("td", { class: "num", text: min(t.execucao_min) }))), "Nenhuma tarefa no período.")),
        el("section", { class: "panel" }, el("h3", { text: "Por cidade" }),
          tabela([["Cidade"], ["Abertas", 1], ["Concluídas", 1], ["No prazo", 1]],
            p.por_cidade.map((c) => el("tr", {}, el("td", { text: c.cidade }), el("td", { class: "num", text: c.abertas }), el("td", { class: "num", text: c.concluidas }),
              el("td", { class: "num", text: pct(c.no_prazo) }))), "Nenhuma tarefa com cidade no período."))),
      el("section", { class: "panel" }, el("h3", { text: "Quando as tarefas aparecem (dia × hora)" }),
        p.dia_hora.length && App.mapaCalor ? App.mapaCalor(p.dia_hora) : el("p", { class: "meta", text: "Nenhuma tarefa no período." })),
      el("section", { class: "panel" }, el("h3", { text: p.equipe ? "Pessoas" : "Você" }),
        p.equipe ? null : el("p", { class: "meta", text: "Esta é a sua linha, com os mesmos números que a liderança vê." }),
        tabela([["Pessoa"], ["Com ela agora", 1], ["Atrasadas", 1], ["Concluídas", 1], ["Registros", 1], ["No prazo", 1], ["👏", 1]],
          p.pessoas.map((x) => el("tr", { class: x.eu ? "eu" : null }, el("td", { text: x.eu ? `${x.nome} (você)` : x.nome }), el("td", { class: "num", text: x.com_ela }),
            el("td", { class: "num" + (x.atrasadas ? " err" : ""), text: x.atrasadas }), el("td", { class: "num", text: x.concluidas }),
            el("td", { class: "num", text: x.registros }), el("td", { class: "num", text: pct(x.no_prazo) }), el("td", { class: "num", text: x.agradecimentos }))), "—")),
      blocoRevisao(),
      P.placar ? el("section", { class: "panel", id: "pn-placar" }, el("div", { class: "inicio-topo" }, el("h3", { style: "margin:0", text: "🏆 Placar" }),
          el("span", { class: "tag opcional", text: "só você vê" })),
        el("p", { class: "meta", text: "Para avaliar, não para expor. Pontos só para ordenar: concluída 3, registro 1, no prazo +1, agradecimento 1, ajuda aceita 2." }),
        tabela([["#", 1], ["Pessoa"], ["Pontos", 1], ["Pegou", 1], ["Concluiu", 1], ["Registros", 1], ["No prazo", 1], ["Até pegar", 1], ["👏", 1], ["🆘", 1], ["Revisões ok/ajustar", 1]],
          P.placar.map((x, i) => el("tr", {}, el("td", { class: "num", text: i + 1 }), el("td", { text: x.nome }), el("td", { class: "num", text: x.pontos }),
            el("td", { class: "num", text: x.pegou }), el("td", { class: "num", text: x.concluidas }), el("td", { class: "num", text: x.registros }),
            el("td", { class: "num", text: pct(x.no_prazo) }), el("td", { class: "num", text: min(x.pegar_min) }), el("td", { class: "num", text: x.agradecimentos }),
            el("td", { class: "num", text: x.ajudas }), el("td", { class: "num", text: `${x.revisoes_ok}/${x.revisoes_ajustar}` }))), "Ninguém no período.")) : null);
  }
  document.querySelectorAll("[data-pn-dias]").forEach((b) => b.addEventListener("click", () => { P.dias = Number(b.dataset.pnDias); P.painel = null; App.render(); App.carregar(); }));

  // ---------- tarefas que se repetem (fim da aba Tarefas) ----------
  async function carregarRecorrentes() { P.rec = await rpc("listar_recorrentes"); }
  function formRecorrente(r) {
    const C = App.tarefasCampos, tipos = C.tipos()?.tipos || [];
    const camposBox = el("div", { class: "campos-grid", id: "pn-rec-campos" });
    const tipo = el("select", { id: "pn-rec-tipo", "aria-label": "Tipo de tarefa" }, tipos.map((t) => el("option", { value: t.tipo, text: `${t.icone || ""} ${t.nome}` })));
    tipo.value = r?.tipo || "livre";
    const titulo = el("input", { id: "pn-rec-titulo", maxlength: 150, placeholder: "O que precisa ser feito" });
    titulo.value = r?.titulo || "";
    const tituloBox = el("label", {}, "Título", titulo);
    const trocar = () => { C.montarCampos(camposBox, tipo.value); tituloBox.hidden = tipo.value !== "livre";
      for (const [k, v] of Object.entries(r?.tipo === tipo.value ? r.campos : {})) { const c = camposBox.querySelector(`[data-campo="${k}"]`); if (c) c.value = v === true ? "sim" : v === false ? "nao" : v; } };
    tipo.addEventListener("change", trocar);
    const freq = el("select", { id: "pn-rec-freq", "aria-label": "Frequência" }, Object.entries(FREQ).map(([v, t]) => el("option", { value: v, text: t })));
    freq.value = r?.frequencia || "diaria";
    const diaSem = el("select", { id: "pn-rec-dia-semana", "aria-label": "Dia da semana" }, DIAS.map((d, i) => el("option", { value: i, text: d })));
    diaSem.value = String(r?.dia_semana ?? 1);
    const diaMes = el("input", { id: "pn-rec-dia-mes", type: "number", min: 1, max: 31, value: r?.dia_mes ?? 1, "aria-label": "Dia do mês" });
    const hora = el("input", { id: "pn-rec-hora", type: "number", min: 0, max: 23, value: r?.hora ?? 8, "aria-label": "Hora" });
    const verFreq = () => { diaSem.hidden = freq.value !== "semanal"; diaMes.hidden = freq.value !== "mensal"; };
    freq.addEventListener("change", verFreq);
    const lista = el("textarea", { id: "pn-rec-checklist", rows: 3, placeholder: "Um item por linha (opcional)" });
    lista.value = (r?.checklist || []).join("\n");
    const para = el("select", { id: "pn-rec-para", "aria-label": "Para quem" }, el("option", { value: "", text: "Para toda a equipe" }),
      ...S.pessoas.map((x) => el("option", { value: x.id, text: x.id === S.me.id ? `${x.nome} (você)` : x.nome })));
    para.value = r?.para?.[0] || "";
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const f = el("form", { class: "cad recorrente-form", id: "pn-rec-form", onsubmit: async (e) => {
      e.preventDefault(); erro.hidden = true;
      try {
        await rpc("salvar_recorrente", { p_id: r?.id || null, p_tipo: tipo.value, p_campos: C.lerCampos(camposBox), p_titulo: titulo.value.trim() || null, p_descricao: null,
          p_para: para.value ? [para.value] : [], p_checklist: lista.value.split("\n"), p_frequencia: freq.value,
          p_dia_semana: Number(diaSem.value), p_dia_mes: Number(diaMes.value), p_hora: Number(hora.value), p_ativa: r ? r.ativa : true });
        P.editando = null; toast(r ? "Recorrente atualizada." : "Pronto: a tarefa vai aparecer sozinha no próximo horário."); await carregarRecorrentes(); App.render();
      } catch (err) { erro.textContent = msgErro(err); erro.hidden = false; }
    } },
      el("div", { class: "campos-grid" }, el("label", {}, "Tipo", tipo), tituloBox),
      camposBox,
      el("div", { class: "actions" }, el("span", { class: "meta", text: "Quando:" }), freq, diaSem, diaMes, el("span", { class: "meta", text: "às" }), hora, el("span", { class: "meta", text: "h (Brasília)" })),
      el("div", { class: "campos-grid" }, el("label", {}, "Para quem", para), el("label", { class: "largo" }, "Checklist", lista)), erro,
      el("div", { class: "actions" }, el("button", { class: "btn primary small", type: "submit" }, r ? "Salvar" : "Criar recorrente"),
        el("button", { class: "btn link", type: "button", onclick: () => { P.editando = null; App.render(); } }, "Cancelar")));
    setTimeout(() => { trocar(); verFreq(); }, 0);
    return f;
  }
  const quando = (r) => `${FREQ[r.frequencia]}${r.frequencia === "semanal" ? " (" + DIAS[r.dia_semana] + ")" : r.frequencia === "mensal" ? " (dia " + r.dia_mes + ")" : ""} às ${r.hora}h`;
  function renderRecorrentes() {
    const box = $("#at-recorrentes");
    if (!box || !App.tarefasCampos.tipos()) return;
    const ativo = document.activeElement;   // não apaga o que a pessoa está digitando
    if (P.editando && box.contains(ativo) && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return;
    const l = P.rec || [];
    box.replaceChildren(el("details", { class: "panel", open: box.dataset.aberto === "1" ? true : null, ontoggle: (e) => (box.dataset.aberto = e.target.open ? "1" : "") },
      el("summary", {}, el("b", { text: "🔁 Tarefas que se repetem" }), el("span", { class: "meta", text: ` · ${l.filter((x) => x.ativa).length} ativa(s)` })),
      el("p", { class: "meta", text: "A tarefa aparece sozinha no horário marcado (todo dia, toda semana ou todo mês), com o checklist pronto." }),
      l.length ? el("ul", { class: "recorrentes-lista" }, l.map((r) => el("li", { class: r.ativa ? null : "pausada" },
        el("div", {}, el("b", { text: `${r.icone || ""} ${r.titulo_exemplo}` }),
          el("div", { class: "meta", text: `${quando(r)} · ${r.para_nomes.length ? "para " + r.para_nomes.join(", ") : "para toda a equipe"}${r.checklist.length ? ` · checklist com ${r.checklist.length}` : ""}${r.ativa ? "" : " · pausada"} · criada por ${r.criada_por_nome || "—"}` })),
        r.pode_mexer ? el("div", { class: "actions" },
          el("button", { class: "btn small", type: "button", onclick: () => { P.editando = r.id; App.render(); } }, "Editar"),
          el("button", { class: "btn small", type: "button", onclick: async () => {
            try { await rpc("salvar_recorrente", { p_id: r.id, p_tipo: r.tipo, p_campos: r.campos, p_titulo: r.titulo, p_descricao: r.descricao, p_para: r.para, p_checklist: r.checklist,
              p_frequencia: r.frequencia, p_dia_semana: r.dia_semana, p_dia_mes: r.dia_mes, p_hora: r.hora, p_ativa: !r.ativa }); await carregarRecorrentes(); App.render(); }
            catch (e) { toast(msgErro(e)); }
          } }, r.ativa ? "Pausar" : "Retomar"),
          el("button", { class: "btn small quiet", type: "button", onclick: async () => {
            try { await rpc("excluir_recorrente", { p_id: r.id }); toast("Recorrente apagada."); await carregarRecorrentes(); App.render(); } catch (e) { toast(msgErro(e)); }
          } }, "Apagar")) : null,
        P.editando === r.id ? formRecorrente(r) : null))) : null,
      P.editando === "nova" ? formRecorrente(null) : el("button", { class: "btn small", type: "button", id: "pn-rec-nova", onclick: () => { P.editando = "nova"; App.render(); } }, "+ Nova recorrente")));
  }

  App.painel = { carregar, render, carregarRecorrentes, renderRecorrentes };
})();
