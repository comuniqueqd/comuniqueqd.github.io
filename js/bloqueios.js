// Módulo "Bloqueios": registro com cálculo automático da punição, tratativas, painel, histórico e regras.
// As regras (ocorrência, horas, encerramento de parceria, tratativa) são calculadas no banco
// (supabase/002-bloqueios.sql); esta tela só mostra e chama as funções.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, janela, fmtCPF, norm, dt, dia, duracao, horas, toast, PAPEL, vazio, carregandoEl, rpc, msgErro,
          tabela, barras, grafico, baixarCSV, filtroPessoas, caixaPessoas, nomesEscolhidos } = App.u;
  const S = App.S;
  const B = {
    regras: null, lista: { ativos: null, meus: null, todos: null }, tarefas: { pendente: null, concluida: null },
    metricas: null, previa: null, resultado: null, consulta: null, destaque: null,
    tratVer: "pendente", caixa: {}, confirmar: {}, tipo: "normal", rascunho: {}, pagina: 1, atencao: null,
  };
  const papel = () => S.me?.papel_bloqueios;
  const staff = () => ["moderador", "monitorador"].includes(papel());
  // corrigir um bloqueio: monitorador/moderador em qualquer um; o suporte nos marcados "revisar" e nos que registrou (008b)
  const podeCorrigir = (b) => !b.dados_pendentes && (staff() || (!!papel() && (!!b.revisar || b.registrado_por === S.me?.id)));
  const mod = () => papel() === "moderador";
  const render = () => App.render();
  const carregar = () => App.carregar();

  const SIT = { bloqueado: "Bloqueado", liberado: "Liberado", liberado_antes: "Liberado antes do prazo", encerramento: "Parceria encerrada", revertido: "Encerramento revertido" };
  const pillSit = (s) => el("span", { class: "pill " + s, text: SIT[s] });
  const horasTxt = (h) => {
    if (h == null) return "Encerramento de parceria";
    h = Number(h);
    if (h < 1) return `${Math.round(h * 60)} min`;
    return h % 24 === 0 && h >= 48 ? `${h / 24} dias (${h} h)` : `${Math.round(h * 100) / 100} h`.replace(".", ",");
  };
  const TAREFA = { tratativa: "Tratativa", encerramento_parceria: "Encerramento de parceria", leves_acumuladas: "Contato por infrações leves", completar_dados: "Completar dados do entregador" };
  const ord = (n) => `${n}ª`;
  function falta(iso) {
    const min = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 48) return m && h < 10 ? `${h} h ${m} min` : `${h} h`;
    return `${Math.round(h / 24)} dias`;
  }
  const infracoes = (leve = false) => (B.regras?.infracoes || []).filter((i) => !!i.leve === leve);
  const todasInfracoes = () => (B.regras?.infracoes || []);
  const cidadesAtivas = () => (B.regras?.cidades || []).filter((c) => c.ativa);
  const respDaCidade = (nome) => { const c = (B.regras?.cidades || []).find((x) => x.nome === nome); return c?.responsavel_valido ? c.responsavel_nome : "Moderadores"; };
  const buscaB = (b, q) => !q || norm([b.id_app, b.nome, b.cidade, b.infracao, b.registrado_por_nome, b.tarefa?.responsavel_nome].join(" ")).includes(norm(q));
  function preencher(sel, opcoes, primeiro) {
    const cur = sel.value, sig = opcoes.map(([v]) => v).join("|");
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    sel.replaceChildren(el("option", { value: "", text: primeiro }), ...opcoes.map(([v, t]) => el("option", { value: v, text: t })));
    sel.value = opcoes.some(([v]) => String(v) === cur) ? cur : "";
  }
  const opcCidades = (lista) => [...new Set(lista.map((b) => b.cidade).filter(Boolean))].sort().map((c) => [c, c]);
  const opcInfracoes = () => todasInfracoes().map((i) => [String(i.id), i.leve ? `${i.nome} (leve)` : i.nome]);
  const filtroTipo = (b, t) => !t || (t === "leve") === !!b.leve;

  // ---------- cartão de um bloqueio (tratativas, bloqueados agora, meus registros) ----------
  function bulletTratativa(b) {
    const t = b.tarefa;
    if (!t) return el("div", { class: "bullet sem", text: b.leve ? "Infração leve: sem tratativa (conta para o limite de leves)." : "Sem tratativa: bloqueio de menos de 10 h." });
    const tipo = TAREFA[t.tipo] || "Tratativa";
    if (t.status === "pendente") return el("div", { class: "bullet " + (t.atrasada ? "atrasada" : "pendente") }, el("span", {},
      el("b", { text: t.atrasada ? `${tipo} atrasada há ${duracao(t.criada_em).txt}` : `${tipo} pendente` }),
      ` com ${t.tipo === "completar_dados" ? "o monitoramento" : t.responsavel_nome}` + (t.atrasada ? ` · prazo de ${t.prazo_horas} h` : ` · há ${duracao(t.criada_em).txt}`),
      t.realocada_em ? ` · realocada por ${t.realocada_por_nome} em ${dt(t.realocada_em)}` : ""));
    return el("div", { class: "bullet concluida" }, el("span", {},
      el("b", { text: `${tipo} realizada` }),
      t.importada ? " (registro importado da planilha)" : ` por ${t.concluida_por_nome} em ${dt(t.concluida_em)}`,
      t.nota ? ` — ${t.nota}` : ""));
  }
  function cardBloqueio(b, { acoes = true } = {}) {
    const sit = b.situacao;
    const cx = B.caixa[b.id];
    const tarefaMinha = staff() && b.tarefa?.status === "pendente" && (mod() || b.tarefa.responsavel_email === S.me.email || b.tarefa.tipo === "completar_dados");
    const completar = b.tarefa?.tipo === "completar_dados";
    const destacado = B.destaque === b.id;
    const classe = "card " + (sit === "encerramento" ? "encerramento" : sit === "revertido" ? "revertido" : b.tarefa?.status === "concluida" ? "tratada" : "bq")
      + (b.tarefa?.atrasada ? " atrasada" : "") + (b.tarefa?.status === "pendente" && b.tarefa.previsao && new Date(b.tarefa.previsao) < Date.now() ? " previsao-passou" : "") + (destacado ? " destaque" : "");
    return el("article", { class: classe, "data-id": b.id },
      el("div", { class: "head" },
        el("span", { class: "name" }, linkFicha(b), el("span", { class: "mono meta", text: b.id_app }), pillSit(sit), b.leve ? el("span", { class: "tag", text: "LEVE" }) : null, destacado ? el("span", { class: "tag", text: "RECÉM-REGISTRADO" }) : null),
        el("span", { class: "espera" + (sit === "bloqueado" ? "" : " velho"), text: sit === "bloqueado" ? `libera em ${falta(b.fim)}` : sit === "encerramento" ? "definitivo" : "" })),
      el("dl", { class: "fields" },
        fld(b.leve ? "Infração leve" : "Infração", b.infracao),
        fld("Ocorrência", b.leve ? "Conta para o limite de leves" : b.ocorrencia < b.ocorrencia_total ? `${ord(b.ocorrencia)} para a punição (${ord(b.ocorrencia_total)} no histórico)` : ord(b.ocorrencia)),
        fld("Punição", horasTxt(b.horas)),
        fld("Início", dt(b.inicio)),
        fld("Fim", b.fim ? dt(b.fim) : "—"),
        fld("Cidade", b.cidade),
        fld("Registrado por", b.registrado_por === S.me.id ? "Você" : b.registrado_por_nome)),
      alertaRevisar(b),
      b.dados_pendentes ? (tarefaMinha && completar
        ? el("button", { class: "alerta-revisar", type: "button", onclick: () => abrir(b.id, "completar") }, "ID sem cadastro: completar nome e cidade ›")
        : el("span", { class: "alerta-revisar", text: "ID sem cadastro: o monitoramento vai completar nome e cidade." })) : null,
      b.gerou_bloqueio ? el("div", { class: "motivo", text: "Esta infração leve atingiu o limite e gerou um bloqueio normal." }) : null,
      b.observacao ? el("div", { class: "obs", text: b.observacao }) : null,
      sit === "liberado_antes" || sit === "revertido" ? el("div", { class: "obs" }, el("b", { text: `${sit === "revertido" ? "Encerramento revertido" : "Liberado antes do prazo"} por ${b.liberado_por_nome} em ${dt(b.liberado_em)}: ` }), b.motivo_liberacao) : null,
      bulletTratativa(b),
      b.tarefa?.status === "pendente" ? App.u.previsao(b.tarefa, "tarefa", b.tarefa.id, tarefaMinha) : null,
      acoes ? el("div", { class: "actions" },
        tarefaMinha ? el("button", { class: "btn approve", type: "button", onclick: () => abrir(b.id, completar ? "completar" : "tratar") },
          completar ? "Completar dados" : b.tarefa.tipo === "encerramento_parceria" ? "Marcar encerramento como tratado" : "Marcar tratativa como resolvida") : null,
        mod() && b.tarefa?.status === "pendente" && b.tarefa.tipo !== "completar_dados" ? el("button", { class: "btn link", type: "button", onclick: () => realocar(b.tarefa, b) }, "Realocar…") : null,
        el("button", { class: "btn link", type: "button", onclick: () => abrirFicha(b.id_app) }, "Consultar entregador"),
        botaoAnexos(b),
        podeCorrigir(b) ? el("button", { class: "btn link", type: "button", onclick: () => abrirCorrecao(b) }, "Corrigir dados") : null,
        el("span", { class: "spacer" }),
        staff() && (sit === "bloqueado" || sit === "encerramento") ? el("button", { class: "btn quiet small", type: "button", onclick: () => abrir(b.id, "liberar") }, sit === "encerramento" ? "Reverter encerramento…" : "Liberar antes do prazo…") : null) : null,
      cx ? caixa(b, cx) : null);
  }
  const fld = (k, v) => el("div", {}, el("dt", { text: k }), el("dd", { text: v || "—" }));

  // ---------- alerta "revisar" e correção de um bloqueio (monitorador e moderador) ----------
  function alertaRevisar(b, curto = false) {
    if (!b.revisar) return null;
    const txt = curto ? "revisar" : "Revisar: " + b.revisar;
    return podeCorrigir(b)
      ? el("button", { class: "alerta-revisar", type: "button", title: "Revisar: " + b.revisar, onclick: (e) => { e.stopPropagation(); abrirCorrecao(b); } }, txt + " ›")
      : el("span", { class: "alerta-revisar", title: b.revisar, text: txt });
  }
  const EVB = { registrado: "Registrado", liberado_antes: "Liberado antes do prazo", tratativa_concluida: "Tratativa realizada", corrigido: "Dados corrigidos", revisado: "Marcado como revisado" };
  function opcoesCidade(atual) {
    const nomes = (B.regras?.cidades || []).filter((c) => c.ativa || c.nome === atual).map((c) => c.nome);
    return [el("option", { value: "", text: atual ? "Escolha a cidade" : "Sem cidade (escolha uma, se souber)" }), ...nomes.map((n) => el("option", { value: n, text: n }))];
  }
  function abrirCorrecao(b) {
    const id = el("input", { class: "mono", maxlength: "40", autocomplete: "off", spellcheck: "false", oninput: (e) => (e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "")) });
    id.value = b.id_app;
    const nome = el("input", { maxlength: "120", autocomplete: "off" }); nome.value = b.nome;
    const cid = el("select", {}, ...opcoesCidade(b.cidade)); cid.value = b.cidade || "";
    const mot = el("textarea", { maxlength: "300", rows: "2", placeholder: "Ex.: ID conferido no aplicativo; nome completo confirmado com o entregador." });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const contexto = el("div", { style: "display:grid;gap:8px" }, el("p", { class: "meta", style: "margin:0", text: "Carregando o histórico deste ID…" }));
    const mudou = () => id.value.trim() !== b.id_app || nome.value.trim() !== b.nome || (cid.value || null) !== (b.cidade || null);
    async function enviar(btn, soRevisado) {
      erro.hidden = true;
      if (!soRevisado && !mudou()) { erro.textContent = b.revisar ? "Nada foi alterado. Se os dados estão certos, use “Os dados estão certos”." : "Nada foi alterado."; erro.hidden = false; return; }
      if (!soRevisado && !mot.value.trim()) { erro.textContent = "Informe o motivo da correção."; erro.hidden = false; mot.focus(); return; }
      btn.disabled = true;
      try {
        await rpc("corrigir_bloqueio", soRevisado
          ? { p_bloqueio: b.id, p_id_app: b.id_app, p_nome: b.nome, p_cidade: b.cidade, p_motivo: mot.value.trim() || null }
          : { p_bloqueio: b.id, p_id_app: id.value.trim(), p_nome: nome.value.trim(), p_cidade: cid.value || null, p_motivo: mot.value.trim() });
        d.close();
        toast(soRevisado ? "Marcado como revisado." : "Bloqueio corrigido. A correção ficou no histórico.");
        await carregar();
        if (B.consulta?.q) reconsultar();
      } catch (e) { btn.disabled = false; erro.textContent = msgErro(e); erro.hidden = false; }
    }
    const d = janela(b.revisar ? "Revisar registro" : "Corrigir dados do bloqueio",
      b.revisar ? el("div", { class: "alerta-revisar bloco" }, el("b", { text: "Por que revisar: " }), b.revisar) : null,
      el("p", { class: "meta", style: "margin:0", text: `${b.infracao}${b.leve ? " (leve)" : ""} · ${dt(b.inicio)} · ${horasTxt(b.horas)} · registrado por ${b.registrado_por_nome}` }),
      el("div", { class: "grid2" },
        el("label", {}, "ID do entregador", id),
        el("label", {}, "Nome do entregador", nome)),
      el("label", {}, "Cidade", cid),
      el("label", {}, "Motivo da correção (obrigatório se alterar algo)", mot),
      el("p", { class: "meta", style: "margin:0", text: "A punição aplicada e a ocorrência gravada não mudam. A correção fica no histórico do bloqueio e no cadastro do entregador." }),
      erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => enviar(e.currentTarget, false) }, "Salvar correção"),
        b.revisar ? el("button", { class: "btn", type: "button", onclick: (e) => enviar(e.currentTarget, true) }, "Os dados estão certos") : null,
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")),
      contexto);
    // outros registros com este ID e histórico deste bloqueio, para ajudar a decidir
    Promise.all([rpc("consultar_entregador", { p_busca: b.id_app }), rpc("eventos_do_bloqueio", { p_bloqueio: b.id })]).then(([c, ev]) => {
      const outros = (c.bloqueios || []).filter((x) => x.id !== b.id && x.id_app.toLowerCase() === b.id_app.toLowerCase());
      const ficha = (c.entregadores || []).find((e) => e.id_app === b.id_app.toLowerCase());
      contexto.replaceChildren(...[
        ficha?.nome ? el("p", { class: "meta", style: "margin:0", text: `Cadastro do entregador com este ID: ${ficha.nome}${ficha.cidade ? " · " + ficha.cidade : ""}.` }) : null,
        el("h4", { style: "margin:4px 0 0", text: outros.length ? `Outros ${outros.length} registro(s) com este ID` : "Nenhum outro registro com este ID" }),
        outros.length ? el("ol", { class: "timeline" }, outros.slice(0, 15).map((x) => el("li", {}, el("b", { text: dt(x.inicio) }), ` · ${x.nome} · ${x.cidade || "sem cidade"} · ${x.infracao}${x.leve ? " (leve)" : ""}`))) : null,
        ev.length ? el("h4", { style: "margin:4px 0 0", text: "Histórico deste registro" }) : null,
        ev.length ? el("ol", { class: "timeline" }, ev.map((x) => el("li", {}, el("b", { text: dt(x.em) }), ` · ${EVB[x.tipo] || x.tipo}${x.por_nome ? " por " + x.por_nome : ""}${x.detalhe ? " · " + x.detalhe : ""}`))) : null].filter(Boolean));
    }).catch(() => contexto.replaceChildren());
  }
  function abrir(id, acao) { B.caixa[id] = B.caixa[id]?.acao === acao ? undefined : { acao, texto: "" }; render(); }
  function caixa(b, cx) {
    if (cx.acao === "completar") {
      const nome = el("input", { "aria-label": "Nome do entregador", placeholder: "Nome do entregador", maxlength: "120", oninput: (e) => (cx.nome = e.target.value) });
      nome.value = cx.nome || "";
      const cid = el("select", { "aria-label": "Cidade", onchange: (e) => (cx.cidade = e.target.value) }, el("option", { value: "", text: "Escolha a cidade" }), ...cidadesAtivas().map((c) => el("option", { value: c.nome, text: c.nome })));
      cid.value = cx.cidade || "";
      return el("div", { class: "box" },
        el("p", { class: "meta", style: "margin:0", text: `Vale para todos os registros do ID ${b.id_app} que estão sem dados. Depois disso, as tarefas vão para o responsável da cidade.` }),
        el("div", { class: "grid2" }, nome, cid),
        el("div", { class: "actions" },
          el("button", { class: "btn approve small", type: "button", onclick: (e) => completarDados(b, cx, e.currentTarget) }, "Salvar dados"),
          el("button", { class: "btn link", type: "button", onclick: () => { delete B.caixa[b.id]; render(); } }, "Cancelar")));
    }
    const tratar = cx.acao === "tratar";
    const reverter = !tratar && b.situacao === "encerramento";
    const txt = el("textarea", { maxlength: "600", rows: "2", placeholder: tratar ? "O que foi feito? (opcional) Ex.: entregador orientado por telefone." : reverter ? "Por que o encerramento está sendo revertido? (obrigatório)" : "Motivo da liberação (obrigatório)", "aria-label": tratar ? "Nota da tratativa" : reverter ? "Motivo da reversão" : "Motivo da liberação", oninput: (e) => (cx.texto = e.target.value) });
    txt.value = cx.texto;
    return el("div", { class: "box" + (tratar ? "" : " encerrar") },
      el("p", { class: "meta", style: "margin:0", text: tratar
        ? "Marcar como resolvida NÃO libera o bloqueio: ele continua até o fim do prazo. Quem registrou recebe um aviso."
        : reverter ? "A parceria deixa de estar encerrada e o entregador volta a poder trabalhar. Quem registrou recebe um aviso com o motivo."
        : "O entregador volta a poder trabalhar agora. Quem registrou recebe um aviso com o motivo." }),
      txt,
      el("div", { class: "actions" },
        el("button", { class: tratar ? "btn approve small" : "btn danger small", type: "button", onclick: (e) => (tratar ? concluir(b.tarefa.id, cx.texto, e.currentTarget, b.id) : liberar(b, cx.texto, e.currentTarget)) }, tratar ? "Confirmar" : reverter ? "Confirmar reversão" : "Confirmar liberação"),
        el("button", { class: "btn link", type: "button", onclick: () => { delete B.caixa[b.id]; render(); } }, "Cancelar")));
  }
  async function concluir(tarefaId, nota, btn, bloqueioId) {
    btn.disabled = true;
    try {
      await rpc("concluir_tratativa", { p_tarefa: tarefaId, p_nota: nota || null });
      if (bloqueioId) delete B.caixa[bloqueioId];
      toast("Tratativa registrada. O bloqueio continua até o fim do prazo.");
      await carregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function completarDados(b, cx, btn) {
    if (!String(cx.nome || "").trim() || !cx.cidade) return toast("Preencha o nome e a cidade.");
    btn.disabled = true;
    try { await rpc("completar_dados_bloqueio", { p_tarefa: b.tarefa.id, p_nome: cx.nome, p_cidade: cx.cidade }); delete B.caixa[b.id]; toast("Dados do entregador completados."); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function liberar(b, motivo, btn) {
    const reverter = b.situacao === "encerramento";
    if (!String(motivo || "").trim()) return toast(reverter ? "Informe o motivo para reverter o encerramento." : "Informe o motivo da liberação.");
    btn.disabled = true;
    try { await rpc("liberar_bloqueio", { p_bloqueio: b.id, p_motivo: motivo }); delete B.caixa[b.id]; toast(reverter ? `Encerramento de ${b.nome} revertido.` : `${b.nome} foi liberado.`); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  // ---------- anexos (até 3 por bloqueio; imagens comprimidas aqui no navegador) ----------
  const podeAnexos = (b) => staff() || b.registrado_por === S.me.id;
  const botaoAnexos = (b) => podeAnexos(b)
    ? el("button", { class: "btn link", type: "button", onclick: () => abrirAnexos(b) }, b.anexos ? `Anexos (${b.anexos})` : "Anexar…") : null;
  const LIMITE = 300 * 1024, ALVO = 200 * 1024;
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const paraBase64 = (blob) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = erro; r.readAsDataURL(blob); });
  async function comprimir(arquivo) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error("Não foi possível abrir a imagem.")); i.src = url; });
      let lado = 1600, qualidade = 0.8, blob = null;
      for (let i = 0; i < 8; i++) {
        const esc = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * esc)); c.height = Math.max(1, Math.round(img.naturalHeight * esc));
        const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", qualidade));
        if (blob.size <= ALVO) break;
        if (qualidade > 0.5) qualidade -= 0.15; else lado = Math.round(lado * 0.75);
      }
      return blob;
    } finally { URL.revokeObjectURL(url); }
  }
  function abrirAnexos(b) {
    const lista = el("ul", { class: "anexos" }, el("li", { class: "meta", text: "Carregando…" }));
    const previa = el("div");
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const arquivo = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,application/pdf", hidden: true });
    const btnEscolher = el("button", { class: "btn", type: "button", onclick: () => arquivo.click() }, "Escolher imagem ou PDF");
    let itens = [];
    async function atualizar() {
      try { itens = await rpc("listar_anexos", { p_bloqueio: b.id }); }
      catch (e) { itens = []; erro.textContent = msgErro(e); erro.hidden = false; }
      btnEscolher.disabled = itens.length >= 3;
      lista.replaceChildren(...(itens.length ? itens.map((a) => el("li", {},
        el("span", {}, el("b", { text: a.nome }), ` · ${kb(a.tamanho)} · ${a.por_nome || "—"} · ${dt(a.em)}`),
        el("span", {},
          el("button", { class: "btn link", type: "button", onclick: (e) => ver(a, e.currentTarget) }, a.tipo === "application/pdf" ? "Baixar" : "Ver"),
          a.pode_excluir ? el("button", { class: "btn link", type: "button", onclick: (e) => excluirAnexo(a, e.currentTarget) }, "Excluir") : null)))
        : [el("li", { class: "meta", text: "Nenhum anexo neste bloqueio." })]));
    }
    async function ver(a, btn) {
      btn.disabled = true;
      try {
        const d = await rpc("baixar_anexo", { p_id: a.id });
        const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: d.tipo }));
        if (d.tipo === "application/pdf") {
          const link = el("a", { href: url, download: d.nome }); document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } else previa.replaceChildren(el("img", { class: "previa-anexo", src: url, alt: d.nome }));
      } catch (e) { toast(msgErro(e)); }
      btn.disabled = false;
    }
    async function excluirAnexo(a, btn) {
      btn.disabled = true;
      try { await rpc("excluir_anexo", { p_id: a.id }); previa.replaceChildren(); toast("Anexo excluído."); await atualizar(); carregar(); }
      catch (e) { btn.disabled = false; toast(msgErro(e)); }
    }
    arquivo.addEventListener("change", async () => {
      const f = arquivo.files[0]; arquivo.value = "";
      if (!f) return;
      erro.hidden = true;
      btnEscolher.disabled = true; btnEscolher.textContent = "Enviando…";
      try {
        let blob = f, nome = f.name, tipo = f.type;
        if (tipo === "application/pdf") {
          if (f.size > LIMITE) throw new Error(`Este PDF tem ${kb(f.size)}. O limite é 300 KB: envie só a página necessária ou um print.`);
        } else if (/^image\//.test(tipo)) {
          blob = await comprimir(f); tipo = "image/jpeg"; nome = nome.replace(/\.[^.]+$/, "") + ".jpg";
          if (blob.size > LIMITE) throw new Error("Mesmo comprimida, a imagem passou de 300 KB. Recorte só a parte necessária.");
        } else throw new Error("Anexe uma imagem (JPG, PNG) ou um PDF.");
        await rpc("anexar", { p_bloqueio: b.id, p_nome: nome, p_tipo: tipo, p_base64: await paraBase64(blob) });
        toast(`Anexo enviado (${kb(blob.size)}).`);
        await atualizar(); carregar();
      } catch (e) { erro.textContent = e.message && !e.code ? e.message : msgErro(e); erro.hidden = false; }
      btnEscolher.textContent = "Escolher imagem ou PDF";
      btnEscolher.disabled = itens.length >= 3;
    });
    const d = janela(`Anexos: ${b.nome}`,
      el("p", { class: "meta", style: "margin:0", text: `${b.infracao} · ${dt(b.inicio)} · até 3 anexos por bloqueio.` }),
      podeAnexos(b) ? el("div", { class: "aviso-anexo" },
        el("b", { text: "Cuidado antes de anexar. " }),
        "Anexe só quando for realmente necessário para entender o caso (ex.: print de conversa, foto de avaria). ",
        "Não anexe documentos pessoais (RG, CPF, comprovantes, dados bancários), nem imagens com o rosto ou os dados de clientes. ",
        "Imagens são comprimidas automaticamente (cerca de 200 KB); PDFs até 300 KB.") : null,
      lista, erro,
      el("div", { class: "actions" }, btnEscolher, arquivo, el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Fechar")),
      previa);
    atualizar();
  }

  // nome do entregador que abre a ficha
  const linkFicha = (b, texto = b.nome) => el("button", { class: "link-ficha", type: "button", title: "Consultar entregador", onclick: (e) => { e.stopPropagation(); abrirFicha(b.id_app); } }, texto);
  function abrirFicha(id) {
    $("#bq-q-consulta").value = id;
    if (location.hash !== "#bloqueios/consultar") location.hash = "#bloqueios/consultar";
    consultar(id);
    scrollTo({ top: 0 });
  }
  App.abrirFicha = abrirFicha;
  // moderador passa uma tarefa para outra pessoa (monitorador ou moderador dos bloqueios)
  function realocar(t, b) {
    const sel = el("select", {}, el("option", { value: "", text: "Escolha a pessoa" }),
      ...(B.regras?.responsaveis || []).filter((p) => p.email !== t.responsavel_email).map((p) => el("option", { value: p.email, text: `${p.nome} (${PAPEL[p.papel]})` })));
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = janela("Realocar tarefa",
      el("p", { style: "margin:0" }, el("b", { text: `${TAREFA[t.tipo] || "Tratativa"}: ${b.nome}` }), ` (${b.infracao})`),
      el("p", { class: "meta", style: "margin:0", text: `Hoje com ${t.responsavel_nome}${t.atrasada ? ` · atrasada há ${duracao(t.criada_em).txt}` : ""}. A pessoa escolhida recebe um aviso.` }),
      el("label", {}, "Passar para", sel),
      erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          const btn = e.currentTarget;
          if (!sel.value) { erro.textContent = "Escolha a pessoa."; erro.hidden = false; return; }
          btn.disabled = true;
          try { await rpc("realocar_tarefa", { p_tarefa: t.id, p_email: sel.value }); d.close(); toast("Tarefa realocada."); await carregar(); }
          catch (err) { btn.disabled = false; erro.textContent = msgErro(err); erro.hidden = false; }
        } }, "Realocar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }

  // ---------- tratativas ----------
  function renderTratativas() {
    document.querySelectorAll("[data-trat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.trat === B.tratVer)));
    const l = B.tarefas[B.tratVer];
    const box = $("#bq-trat-lista");
    $("#bq-trat-sub").textContent = mod()
      ? "Bloqueios de 10 h ou mais, encerramentos de parceria e contatos por infrações leves de todas as cidades, mais os IDs que precisam de dados. Resolver a tratativa não libera o bloqueio."
      : "Bloqueios de 10 h ou mais, encerramentos de parceria e contatos por infrações leves das suas cidades, mais os IDs que precisam de dados (de qualquer cidade). Resolver a tratativa não libera o bloqueio.";
    if (!l) return box.replaceChildren(carregandoEl());
    preencher($("#bq-trat-cidade"), opcCidades(l.map((t) => t.bloqueio)), "Todas as cidades");
    const q = $("#bq-q-trat").value, cid = $("#bq-trat-cidade").value;
    const lista = l.filter((t) => buscaB(t.bloqueio, q) && (!cid || t.bloqueio.cidade === cid));
    if (B.tratVer === "concluida") lista.sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em)));
    if (!l.length) return box.replaceChildren(vazio(B.tratVer === "pendente" ? "Nenhuma tratativa pendente" : "Nenhuma tratativa concluída ainda", B.tratVer === "pendente" ? "Quando um bloqueio de 10 h ou mais for registrado nas suas cidades, ele aparece aqui." : ""));
    if (!lista.length) return box.replaceChildren(vazio("Nada com esse filtro", "Limpe a busca ou troque a cidade."));
    const grupo = (tipo) => lista.filter((t) => t.tipo === tipo);
    box.replaceChildren(...[["Completar dados do entregador", grupo("completar_dados")], ["Encerramentos de parceria", grupo("encerramento_parceria")],
      ["Contato por infrações leves acumuladas", grupo("leves_acumuladas")], ["Tratativas de bloqueio", grupo("tratativa")]].filter(([, x]) => x.length).map(([tit, x]) =>
      el("div", { class: "grupo" }, el("h3", {}, tit, el("span", { class: "count", text: x.length })), el("div", { class: "queue" }, x.map((t) => cardBloqueio(t.bloqueio))))));
  }

  document.querySelectorAll("[data-trat]").forEach((b) => b.addEventListener("click", () => { B.tratVer = b.dataset.trat; render(); carregar(); }));

  // ---------- bloqueados agora ----------
  function renderAtivos() {
    const l = B.lista.ativos, box = $("#bq-ativos-lista");
    if (!l) return box.replaceChildren(carregandoEl());
    preencher($("#bq-ativos-cidade"), opcCidades(l), "Todas as cidades");
    preencher($("#bq-ativos-inf"), opcInfracoes(), "Todas as infrações");
    const q = $("#bq-q-ativos").value, cid = $("#bq-ativos-cidade").value, inf = $("#bq-ativos-inf").value;
    const lista = l.filter((b) => buscaB(b, q) && (!cid || b.cidade === cid) && (!inf || String(b.infracao_id) === inf))
      .sort((a, b) => (a.fim ? 0 : 1) - (b.fim ? 0 : 1) || String(a.fim || a.inicio).localeCompare(String(b.fim || b.inicio)));
    if (!l.length) return box.replaceChildren(vazio("Ninguém bloqueado agora", ""));
    if (!lista.length) return box.replaceChildren(vazio("Nada com esse filtro", ""));
    box.replaceChildren(el("div", { class: "queue" }, lista.map((b) => cardBloqueio(b))));
  }

  // ---------- novo bloqueio ----------
  let tPrevia = null, seqPrevia = 0;
  function pedirPrevia() {
    clearTimeout(tPrevia);
    tPrevia = setTimeout(async () => {
      const id = $("#bq-id").value.trim(), inf = $("#bq-infracao").value;
      const minha = ++seqPrevia;
      if (id.length < 4) { B.previa = null; return renderNovo(); }
      try {
        const p = await rpc("previa_bloqueio", { p_id_app: id, p_infracao: inf ? Number(inf) : null });
        if (minha !== seqPrevia) return;
        B.previa = { ...p, id, inf };
        // sugere o nome e a cidade do cadastro do entregador (ou do último registro com dados)
        if (!$("#bq-nome").value.trim() && p.nome_conhecido) $("#bq-nome").value = p.nome_conhecido;
        if (!$("#bq-cidade").value && p.cidade_conhecida && cidadesAtivas().some((c) => c.nome === p.cidade_conhecida)) $("#bq-cidade").value = p.cidade_conhecida;
      } catch (e) { B.previa = { erro: msgErro(e) }; }
      renderNovo();
    }, 350);
  }
  function renderNovo() {
    const leve = B.tipo === "leve";
    document.querySelectorAll("[data-tipo-bq]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tipoBq === B.tipo)));
    document.querySelectorAll("[data-so-normal]").forEach((x) => (x.hidden = leve));
    $("#bq-rotulo-inf").firstChild.textContent = leve ? "Motivo " : "Infração ";
    $("#bq-enviar").textContent = leve ? "Registrar infração leve" : "Registrar bloqueio";
    const par = B.regras?.leves;
    $("#bq-tipo-ajuda").textContent = leve
      ? `Aviso rápido: só o ID e o motivo. A cada ${par?.limite ?? 3} infrações leves em ${par?.janela_dias ?? 50} dias, o sistema gera um bloqueio normal e uma tarefa de contato.`
      : "Bloqueio com punição calculada pelas regras (ocorrência, reincidência, encerramento de parceria).";
    preencher($("#bq-cidade"), cidadesAtivas().map((c) => [c.nome, c.nome]), "Escolha a cidade");
    preencher($("#bq-infracao"), infracoes(leve).filter((i) => i.ativa).map((i) => [String(i.id), i.nome]), leve ? "Escolha o motivo" : "Escolha a infração");
    const box = $("#bq-previa"), p = B.previa;
    const id = $("#bq-id").value.trim(), inf = $("#bq-infracao").value;
    if (B.resultado) { box.replaceChildren(resultado(B.resultado)); return; }
    if (!p || id.length < 4) return box.replaceChildren(el("p", { class: "meta", text: leve ? "Digite o ID do entregador e escolha o motivo para ver o aviso antes de registrar." : "Digite o ID do entregador e escolha a infração para ver a punição antes de registrar." }));
    if (p.erro) return box.replaceChildren(el("p", { class: "err", text: p.erro }));
    const partes = [];
    if (inf && p.leve && p.leves) {
      const L = p.leves;
      partes.push(el("div", { class: "previa" },
        el("div", { class: "meta", text: `${ord(L.esta_sera)} infração leve nos últimos ${L.janela_dias} dias (a ${ord(L.limite)} gera bloqueio)` }),
        el("div", { class: "grande", text: `Aplicar aviso de ${horasTxt(p.horas)}` }),
        el("div", { text: p.nome_conhecido ? `Entregador: ${p.nome_conhecido}${p.cidade_conhecida ? " · " + p.cidade_conhecida : ""}` : "ID sem registro: o monitoramento vai completar nome e cidade." })));
      if (L.gera_bloqueio) partes.push(el("div", { class: "previa encerra" },
        el("div", { class: "meta", text: `Esta é a ${ord(L.esta_sera)} infração leve: atinge o limite.` }),
        el("div", { class: "grande", text: L.bloqueio_encerra ? "Gera também: encerramento de parceria" : `Gera também: bloqueio de ${horasTxt(L.bloqueio_horas)}` }),
        el("div", { text: `Infração “${L.bloqueio_infracao}”, mais uma tarefa de contato para ${p.cidade_conhecida ? respDaCidade(p.cidade_conhecida) : "o monitoramento"}. Depois disso, a contagem de leves zera.` })));
    }
    if (inf && p.ocorrencia && !p.leve) {
      const infNome = todasInfracoes().find((i) => String(i.id) === inf)?.nome;
      partes.push(el("div", { class: "previa" + (p.encerramento ? " encerra" : "") },
        el("div", { class: "meta", text: `${ord(p.ocorrencia)} ocorrência de “${infNome}”` + (p.reiniciada ? ` · contagem zerada: mais de ${p.janela_dias} dias sem esta infração (${ord(p.total)} no histórico)` : "") }),
        el("div", { class: "grande", text: p.encerramento ? "Encerramento de parceria" : `Aplicar ${horasTxt(p.horas)} de bloqueio` }),
        !p.encerramento ? el("div", { text: `Se registrar agora, o bloqueio termina em ${dt(new Date(Date.now() + p.horas * 3600000).toISOString())} e é retirado automaticamente.` }) : el("div", { text: "Bloqueio definitivo: o entregador não volta à operação." }),
        el("div", { class: "meta", text: p.gera_tratativa ? `Gera ${p.encerramento ? "tarefa de encerramento de parceria" : "tratativa"} para ${respDaCidade($("#bq-cidade").value)}.` : "Bloqueio curto: não gera tratativa." })));
    }
    if (p.comentarios?.length) partes.push(el("div", { class: "panel", style: "margin:0" },
      el("h3", { text: "Comentários sobre este entregador" }), listaComentarios(p.comentarios.slice(0, 5))));
    const hist = p.historico || [];
    const nomeDigitado = norm($("#bq-nome").value.trim());
    partes.push(el("div", { class: "panel", style: "margin:0" },
      el("h3", { text: hist.length ? `Histórico deste ID (${hist.length} bloqueio(s))` : "Este ID não tem bloqueios anteriores" }),
      p.cadastro ? el("p", { class: "meta", text: `Cadastro na ativação: ${p.cadastro.situacao} (enviado em ${dt(p.cadastro.enviado_em)}, ${p.cadastro.cidade}).` }) : el("p", { class: "meta", text: "Sem cadastro no módulo de ativação." }),
      hist.length ? el("ol", { class: "timeline" }, hist.slice(0, 12).map((h) => el("li", {},
        el("b", { text: dt(h.inicio) }), ` · ${h.infracao}${h.leve ? " (leve)" : " · " + ord(h.ocorrencia)} · ${horasTxt(h.horas)} · ${SIT[h.situacao]} · por ${h.registrado_por_nome}`,
        !leve && nomeDigitado && !h.dados_pendentes && norm(h.nome) !== nomeDigitado ? el("span", { class: "alerta-revisar", text: ` registrado como “${h.nome}”` }) : null))) : null));
    box.replaceChildren(...partes);
  }
  function resultado(r) {
    if (r.leve) {
      const g = r.gerado;
      return el("div", { style: "display:grid;gap:12px" },
        el("div", { class: "previa" },
          el("div", { class: "meta", text: `Infração leve registrada: ${r.nome || "ID " + r.id_app} · “${r.infracao}” (${ord(r.leves)} de ${r.limite} em ${r.janela_dias} dias)` }),
          el("div", { class: "grande", text: `Aplique aviso de ${horasTxt(r.horas)}` }),
          el("div", { text: `Até ${dt(r.fim)}. O sistema retira sozinho nesse horário.` }),
          r.dados_pendentes ? el("div", { class: "meta", text: "ID sem registro: o monitoramento recebeu a tarefa de completar nome e cidade." }) : null),
        g ? el("div", { class: "previa encerra" },
          el("div", { class: "meta", text: `Limite de infrações leves atingido: bloqueio normal gerado (“${g.infracao}”, ${ord(g.ocorrencia)} ocorrência).` }),
          el("div", { class: "grande", text: g.horas == null ? "Aplique também: encerramento de parceria" : `Aplique também: bloqueio de ${horasTxt(g.horas)}` }),
          g.fim ? el("div", { text: `Até ${dt(g.fim)}.` }) : null,
          el("div", { class: "meta", text: `Tarefa de contato enviada para ${g.responsavel}.` })) : null,
        el("div", { class: "actions" },
          el("button", { class: "btn primary", type: "button", onclick: () => { B.resultado = null; B.previa = null; renderNovo(); $("#bq-id").focus(); } }, "Registrar outra"),
          el("button", { class: "btn", type: "button", onclick: () => { B.resultado = null; verNoHistorico(r.id_app); } }, "Ver no Histórico")));
    }
    return el("div", { class: "previa" + (r.horas == null ? " encerra" : "") },
      el("div", { class: "meta", text: `Bloqueio registrado: ${r.nome} · ${ord(r.ocorrencia)} ocorrência de “${r.infracao}”` }),
      el("div", { class: "grande", text: r.horas == null ? "Encerramento de parceria registrado" : `Aplique ${horasTxt(r.horas)} de bloqueio` }),
      r.fim ? el("div", { text: `Até ${dt(r.fim)}. O sistema retira o bloqueio sozinho nesse horário.` }) : null,
      el("div", { class: "meta", text: r.tarefa ? `Tratativa enviada para ${r.responsavel}. Você recebe um aviso quando ela for feita.` : "Bloqueio curto: sem tratativa." }),
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: () => { B.resultado = null; B.previa = null; renderNovo(); $("#bq-id").focus(); } }, "Registrar outro"),
        el("button", { class: "btn", type: "button", onclick: () => { B.resultado = null; verNoHistorico(r.id_app); } }, "Ver no Histórico")));
  }
  $("#bq-id").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, ""); B.resultado = null; pedirPrevia(); });
  $("#bq-infracao").addEventListener("change", () => { B.resultado = null; pedirPrevia(); });
  $("#bq-cidade").addEventListener("change", () => renderNovo());
  $("#bq-nome").addEventListener("change", () => renderNovo());
  $("#bq-form").addEventListener("input", () => ($("#bq-erro").hidden = true));
  document.querySelectorAll("[data-tipo-bq]").forEach((b) => b.addEventListener("click", () => {
    B.tipo = b.dataset.tipoBq; B.resultado = null; B.previa = null;
    $("#bq-infracao").dataset.sig = ""; $("#bq-infracao").value = "";
    $("#bq-erro").hidden = true;
    renderNovo(); pedirPrevia();
  }));
  $("#bq-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = { id: $("#bq-id").value.trim(), nome: $("#bq-nome").value.trim(), cidade: $("#bq-cidade").value, inf: $("#bq-infracao").value, obs: $("#bq-obs").value.trim(), com: $("#bq-comentario").value.trim() };
    const leve = B.tipo === "leve";
    const erro = v.id.length < 4 ? "Preencha o ID do entregador." : leve ? (!v.inf ? "Escolha o motivo." : "")
      : !v.nome ? "Preencha o nome do entregador." : !v.cidade ? "Escolha a cidade." : !v.inf ? "Escolha a infração." : "";
    if (erro) { $("#bq-erro").textContent = erro; $("#bq-erro").hidden = false; return; }
    const btn = $("#bq-enviar"); btn.disabled = true;
    if (leve) {
      try {
        const r = await rpc("registrar_infracao_leve", { p_id_app: v.id, p_infracao: Number(v.inf), p_observacao: v.obs || null, p_comentario: v.com || null });
        B.resultado = { ...r, leve: true, id_app: v.id, infracao: todasInfracoes().find((i) => String(i.id) === v.inf)?.nome };
        $("#bq-form").reset(); B.previa = null;
        toast(r.gerado ? "Infração leve registrada e bloqueio normal gerado." : `Infração leve registrada: aplique ${horasTxt(r.horas)}.`);
        renderNovo(); carregar();
      } catch (e) { $("#bq-erro").textContent = msgErro(e); $("#bq-erro").hidden = false; }
      finally { btn.disabled = false; }
      return;
    }
    try {
      const r = await rpc("registrar_bloqueio", { p_id_app: v.id, p_nome: v.nome, p_cidade: v.cidade, p_infracao: Number(v.inf), p_observacao: v.obs || null, p_comentario: v.com || null });
      B.resultado = { ...r, nome: v.nome, infracao: todasInfracoes().find((i) => String(i.id) === v.inf)?.nome, responsavel: respDaCidade(v.cidade) };
      const cidade = v.cidade;
      $("#bq-form").reset(); $("#bq-cidade").value = cidade;
      B.previa = null;
      toast(r.horas == null ? "Encerramento de parceria registrado." : `Bloqueio registrado: aplique ${horasTxt(r.horas)}.`);
      renderNovo();
      carregar();
    } catch (e) { $("#bq-erro").textContent = msgErro(e); $("#bq-erro").hidden = false; }
    finally { btn.disabled = false; }
  });

  // ---------- consultar entregador: cadastro, comentários e bloqueios de cada ID ----------
  async function consultar(q) {
    B.consulta = { carregando: true, q };
    renderConsulta();
    try { B.consulta = { q, ...(await rpc("consultar_entregador", { p_busca: q })) }; }
    catch (e) { B.consulta = { q, erro: msgErro(e) }; }
    renderConsulta();
  }
  async function reconsultar() {
    const q = B.consulta?.q;
    if (!q) return;
    try { B.consulta = { q, ...(await rpc("consultar_entregador", { p_busca: q })) }; } catch (e) { toast(msgErro(e)); }
    render();
  }
  $("#bq-cadastrar-entregador").addEventListener("click", () => App.cadastrarEntregador());
  $("#bq-f-consulta").addEventListener("submit", (ev) => {
    ev.preventDefault();
    consultar($("#bq-q-consulta").value.trim());
  });
  function listaComentarios(lista, aoApagar) {
    return el("ul", { class: "comentarios" }, lista.map((c) => el("li", { class: c.tipo === "alteracao" ? "alteracao" : null },
      el("div", { class: "quem" },
        el("span", { text: `${c.por_nome || "—"} · ${dt(c.em)}${c.tipo === "alteracao" ? " · alteração" : ""}` }),
        aoApagar && c.tipo === "comentario" && (mod() || c.por === S.me.id)
          ? el("button", { class: "btn link", type: "button", style: "padding:0;font-size:12px", onclick: (e) => aoApagar(c, e.currentTarget) }, "Apagar") : null),
      el("div", { text: c.texto }))));
  }
  async function apagarComentario(c, btn) {
    btn.disabled = true;
    try { await rpc("excluir_comentario", { p_id: c.id }); toast("Comentário apagado."); await reconsultar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function comentar(idApp, btn) {
    const txt = String(B.rascunho[idApp] || "").trim();
    if (!txt) return toast("Escreva o comentário.");
    btn.disabled = true;
    try { await rpc("comentar_entregador", { p_id_app: idApp, p_texto: txt }); delete B.rascunho[idApp]; document.activeElement?.blur(); toast("Comentário adicionado."); await reconsultar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  function abrirEdicao(f, qtdBloqueios) {
    const nome = el("input", { maxlength: "120", autocomplete: "off" }); nome.value = f.nome || "";
    const cid = el("select", {}, ...opcoesCidade(f.cidade)); cid.value = f.cidade || "";
    const aplicar = el("input", { type: "checkbox" });
    const mot = el("textarea", { maxlength: "300", rows: "2", placeholder: "Opcional. Ex.: nome completo confirmado pelo documento." });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const d = janela("Alterar dados do entregador",
      el("p", { class: "meta", style: "margin:0" }, "ID ", el("span", { class: "mono", text: f.id_app })),
      el("label", {}, "Nome do entregador", nome),
      el("label", {}, "Cidade", cid),
      qtdBloqueios ? el("label", { class: "marcar" }, aplicar,
        el("span", { text: `Aplicar também aos ${qtdBloqueios} bloqueio(s) já registrados com este ID. Deixe desmarcado se o ID foi usado por pessoas diferentes (corrija esses registros um por um).` })) : null,
      el("label", {}, "Motivo", mot),
      el("p", { class: "meta", style: "margin:0", text: "Os próximos registros deste ID já vêm com estes dados. A alteração fica registrada nos comentários do entregador." }),
      erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          erro.hidden = true;
          const btn = e.currentTarget;
          if (!nome.value.trim()) { erro.textContent = "Preencha o nome do entregador."; erro.hidden = false; return; }
          btn.disabled = true;
          try {
            const r = await rpc("salvar_entregador", { p_id_app: f.id_app, p_nome: nome.value.trim(), p_cidade: cid.value || null, p_aplicar: aplicar.checked, p_motivo: mot.value.trim() || null });
            d.close();
            toast(r.bloqueios_alterados ? `Dados salvos e aplicados a ${r.bloqueios_alterados} bloqueio(s).` : "Dados do entregador salvos.");
            await reconsultar(); carregar();
          } catch (err) { btn.disabled = false; erro.textContent = msgErro(err); erro.hidden = false; }
        } }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    nome.focus();
  }
  function tabelaBloqueios(bl) {
    return el("div", { class: "tablewrap" }, el("table", {}, ...tabela(
      [["Data"], ["Nome registrado"], ["Infração"], ["Ocorr."], ["Punição"], ["Situação"], ["Registrado por"], ["Tratativa"], [""]],
      bl.map((b) => el("tr", {}, el("td", { text: dt(b.inicio) }),
        el("td", {}, b.nome, b.cidade ? el("div", { class: "meta", text: b.cidade }) : null, alertaRevisar(b, true)),
        el("td", { text: b.infracao + (b.leve ? " (leve)" : "") }), el("td", { text: b.leve ? "—" : ord(b.ocorrencia) }), el("td", { text: horasTxt(b.horas) }), el("td", {}, pillSit(b.situacao)),
        el("td", { text: b.registrado_por_nome }), el("td", {}, bulletTratativa(b)),
        el("td", { style: "white-space:nowrap" }, podeCorrigir(b) ? el("button", { class: "btn quiet small", type: "button", onclick: () => abrirCorrecao(b) }, "Corrigir") : null, botaoAnexos(b)))), "")));
  }
  const MOD_TXT = { ativacao: "ATIVAÇÃO", bloqueios: "BLOQUEIOS" };
  function renderConsulta() {
    const box = $("#bq-consulta"), c = B.consulta;
    if (!c) return box.replaceChildren(el("p", { class: "meta", text: "Busque pelo ID do entregador (completo), por parte do nome ou pelo CPF do cadastro. Em qualquer tela, clicar no nome de um entregador abre esta consulta." }));
    if (c.carregando) return box.replaceChildren(carregandoEl());
    if (c.erro) return box.replaceChildren(el("p", { class: "err", text: c.erro }));
    const fichas = c.entregadores || [], bl = c.bloqueios || [];
    if (!fichas.length && !c.cadastros.length) return box.replaceChildren(vazio("Nenhum entregador encontrado", "Confira o ID ou tente outra parte do nome."),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: () => App.cadastrarEntregador(/^[A-Za-z0-9]{4,40}$/.test(c.q || "") ? c.q : "") }, "Cadastrar este entregador")));
    const cadDe = (id) => c.cadastros.filter((x) => (x.id_app || "").toLowerCase() === id);
    const soltos = c.cadastros.filter((x) => !fichas.some((f) => f.id_app === (x.id_app || "").toLowerCase()));
    const linhaCadastro = (x) => el("li", { text: `${x.situacao} · ${x.cidade}${x.cpf ? " · CPF " + fmtCPF(x.cpf) : ""} · enviado por ${x.enviado_por_nome} em ${dt(x.enviado_em)}${x.decidido_em ? " · decidido em " + dt(x.decidido_em) : ""}${x.motivo ? " · " + x.motivo : ""}` });
    box.replaceChildren(...[
      fichas.length > 1 ? el("p", { class: "meta", text: `${fichas.length} IDs encontrados.` }) : null,
      ...fichas.map((f) => {
        const seus = bl.filter((b) => b.id_app.toLowerCase() === f.id_app);
        const normais = seus.filter((b) => !b.leve), leves = seus.filter((b) => b.leve);
        const nomes = f.nomes_usados || [];
        const cad = cadDe(f.id_app);
        const txt = el("textarea", { maxlength: "1500", rows: "2", placeholder: "Novo comentário sobre este entregador", "aria-label": "Novo comentário sobre " + (f.nome || f.id_app), oninput: (e) => (B.rascunho[f.id_app] = e.target.value) });
        txt.value = B.rascunho[f.id_app] || "";
        const tempo = f.linha_do_tempo || [];
        return el("div", { class: "panel ficha" },
          el("div", { class: "ficha-topo" },
            el("h3", {}, f.nome || "(sem nome no cadastro)", " ", el("span", { class: "mono meta", text: f.id_app })),
            staff() ? el("button", { class: "btn small", type: "button", onclick: () => abrirEdicao(f, seus.filter((b) => !b.dados_pendentes).length) }, "Alterar dados") : null),
          el("div", { class: "chips", style: "margin-bottom:10px" },
            el("span", { class: "chip", text: f.cidade || "Sem cidade" }),
            el("span", { class: "chip" + (seus.some((b) => b.situacao === "bloqueado") ? " x" : ""), text: seus.some((b) => b.situacao === "bloqueado") ? "Bloqueado agora" : "Não está bloqueado agora" }),
            seus.some((b) => b.situacao === "encerramento") ? el("span", { class: "chip x", text: "Parceria encerrada" }) : null,
            el("span", { class: "chip", text: `${normais.length} bloqueio(s)` }),
            el("span", { class: "chip", text: `${leves.length} infração(ões) leve(s)` }),
            el("span", { class: "chip", text: cad.length ? "Ativação: " + cad.map((x) => x.situacao).join(", ") : "Sem cadastro na ativação" })),
          nomes.length > 1 ? el("p", { class: "alerta-revisar bloco", text: `Este ID aparece com ${nomes.length} nomes nos bloqueios: ${nomes.join(", ")}. Se forem pessoas diferentes, corrija o ID de cada registro.` }) : null,
          f.atualizado_em ? el("p", { class: "meta", text: `Dados alterados por ${f.atualizado_por_nome} em ${dt(f.atualizado_em)}.` }) : null,
          cad.length ? el("div", {}, el("h4", { style: "margin:12px 0 6px", text: "Cadastro na ativação" }), el("ul", { style: "margin:0;padding-left:18px" }, cad.map(linhaCadastro))) : null,
          el("h4", { style: "margin:12px 0 6px", text: f.comentarios.length ? `Comentários (${f.comentarios.length})` : "Comentários" }),
          f.comentarios.length ? listaComentarios(f.comentarios, apagarComentario) : el("p", { class: "meta", text: "Nenhum comentário ainda." }),
          el("div", { style: "display:grid;gap:6px" }, txt,
            el("div", { class: "actions" }, el("button", { class: "btn small", type: "button", onclick: (e) => comentar(f.id_app, e.currentTarget) }, "Adicionar comentário"))),
          tempo.length ? el("details", { style: "margin-top:14px", open: B.tempoAberto?.[f.id_app] ? true : null, ontoggle: (e) => { B.tempoAberto = { ...(B.tempoAberto || {}), [f.id_app]: e.target.open }; } },
            el("summary", { style: "cursor:pointer;font-weight:600", text: `Linha do tempo (${tempo.length})` }),
            el("ol", { class: "timeline", style: "margin-top:8px" }, tempo.map((x) => el("li", {},
              el("b", { text: dt(x.em) }), " ", el("span", { class: "tag", text: MOD_TXT[x.modulo] }), ` ${x.texto}${x.por_nome ? " · " + x.por_nome : ""}${x.detalhe ? " · " + x.detalhe : ""}`)))) : null,
          el("h4", { style: "margin:14px 0 6px", text: normais.length ? `Bloqueios (${normais.length})` : "Nenhum bloqueio" }),
          normais.length ? tabelaBloqueios(normais) : null,
          leves.length ? el("h4", { style: "margin:14px 0 6px", text: `Infrações leves (${leves.length})` }) : null,
          leves.length ? tabelaBloqueios(leves) : null);
      }),
      soltos.length ? el("div", { class: "panel" },
        el("h3", { text: "Cadastros na ativação sem bloqueios" }),
        el("ul", {}, soltos.map((x) => el("li", { text: `${x.id_app || "(sem ID)"} · ${x.situacao} · ${x.cidade}${x.cpf ? " · CPF " + fmtCPF(x.cpf) : ""} · enviado em ${dt(x.enviado_em)}${x.motivo ? " · " + x.motivo : ""}` })))) : null,
    ].filter(Boolean));
  }

  // ---------- histórico ----------
  // filtros do Histórico: a busca e os filtros rodam no banco, que devolve só a página da tela (100 por vez)
  const POR_PAGINA = 100;
  function argsHist(por = POR_PAGINA, pagina = B.pagina || 1) {
    const inf = $("#bq-hist-inf").value;
    return { p_pagina: pagina, p_por: por, p_busca: $("#bq-q-hist").value.trim() || null, p_situacao: $("#bq-hist-sit").value || null,
      p_cidade: $("#bq-hist-cidade").value || null, p_infracao: inf ? Number(inf) : null, p_quem: $("#bq-hist-quem").value || null, p_tipo: $("#bq-hist-tipo").value || null };
  }
  const chaveHist = () => { const a = argsHist(); delete a.p_pagina; return JSON.stringify(a); };
  async function carregarHist() {
    const chave = chaveHist();
    if (B.histChave !== chave) { B.histChave = chave; B.pagina = 1; }
    const d = await rpc("listar_bloqueios_pagina", argsHist());
    if (chave === chaveHist()) B.hist = d;
  }
  let histT = null;
  const filtrarHist = () => { clearTimeout(histT); histT = setTimeout(() => App.carregar(), 300); };
  // atalho do cartão "Revisar registros da planilha"
  function abrirRevisar() {
    ["#bq-q-hist", "#bq-hist-cidade", "#bq-hist-inf", "#bq-hist-quem", "#bq-hist-tipo"].forEach((x) => ($(x).value = ""));
    $("#bq-hist-sit").value = "revisar";
    B.hist = null;
    if (location.hash === "#bloqueios/historico") App.carregar(); else location.hash = "#bloqueios/historico";
  }

  // depois de registrar: o Histórico já filtrado pelo ID (008c: o Histórico junta o antigo "Meus registros")
  function verNoHistorico(id) {
    ["#bq-hist-cidade", "#bq-hist-inf", "#bq-hist-quem", "#bq-hist-tipo", "#bq-hist-sit"].forEach((x) => ($(x).value = ""));
    $("#bq-q-hist").value = id || "";
    B.hist = null; B.pagina = 1;
    if (location.hash === "#bloqueios/historico") App.carregar(); else location.hash = "#bloqueios/historico";
  }
  function renderHist() {
    const h = B.hist, t = $("#bq-t-hist");
    const cols = [["Situação"], ["Entregador"], ["Infração"], ["Ocorr."], ["Punição"], ["Início"], ["Cidade"], ["Registrado por"], ["Tratativa"], [""]];
    if (!h) { $("#bq-hist-total").textContent = ""; return t.replaceChildren(...tabela(cols, [], "Carregando…")); }
    preencher($("#bq-hist-cidade"), h.cidades.slice().sort().map((c) => [c, c]), "Todas as cidades");
    preencher($("#bq-hist-inf"), opcInfracoes(), "Todas as infrações");
    preencher($("#bq-hist-quem"), h.quem.slice().sort().map((n) => [n, n]), "Registrado por qualquer pessoa");
    const paginas = Math.max(1, Math.ceil(h.total / h.por));
    const ini = (h.pagina - 1) * h.por;
    $("#bq-hist-total").textContent = `${h.total} de ${h.total_geral} bloqueio(s)` + (paginas > 1 ? ` · mostrando ${ini + 1} a ${Math.min(ini + h.por, h.total)}` : "");
    const ir = (n) => { B.pagina = n; App.carregar(); $("#bq-t-hist").scrollIntoView({ block: "start" }); };
    $("#bq-hist-paginas").replaceChildren(...(paginas > 1 ? [
      el("button", { class: "btn small", type: "button", disabled: h.pagina === 1, onclick: () => ir(h.pagina - 1) }, "‹ Anterior"),
      el("span", { text: `Página ${h.pagina} de ${paginas}` }),
      el("button", { class: "btn small", type: "button", disabled: h.pagina === paginas, onclick: () => ir(h.pagina + 1) }, "Próxima ›")] : []));
    t.replaceChildren(...tabela(cols, h.itens.map((b) => {
      const acoes = el("td", { style: "white-space:nowrap" });
      if (podeCorrigir(b) && !B.confirmar[b.id]) acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => abrirCorrecao(b) }, "Corrigir"));
      acoes.append(botaoAnexos(b));
      if (mod()) {
        if (B.confirmar[b.id]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => excluir(b, e.currentTarget) }, "Confirmar exclusão"), el("button", { class: "btn link", type: "button", onclick: () => { delete B.confirmar[b.id]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { B.confirmar[b.id] = true; render(); } }, "Excluir"));
      }
      return el("tr", {}, el("td", {}, pillSit(b.situacao), b.revisar ? el("div", {}, alertaRevisar(b, true)) : null),
        el("td", {}, linkFicha(b), el("br"), el("span", { class: "mono meta", text: b.id_app })),
        el("td", {}, b.infracao, b.leve ? el("span", { class: "tag", style: "margin-left:6px", text: "LEVE" }) : null),
        el("td", { text: b.leve ? "—" : ord(b.ocorrencia) + (b.ocorrencia < b.ocorrencia_total ? ` (${ord(b.ocorrencia_total)})` : "") }),
        el("td", { text: horasTxt(b.horas) }), el("td", { text: dt(b.inicio) }), el("td", { text: b.cidade || "—" }), el("td", { text: b.registrado_por_nome }),
        el("td", {}, bulletTratativa(b)), acoes);
    }), "Nenhum bloqueio com esse filtro."));
  }
  async function excluir(b, btn) {
    btn.disabled = true;
    try { await rpc("excluir_bloqueio", { p_bloqueio: b.id }); delete B.confirmar[b.id]; toast("Bloqueio excluído."); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  $("#bq-export").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    let itens;
    try { itens = (await rpc("listar_bloqueios_pagina", argsHist(5000, 1))).itens; } catch (e) { btn.disabled = false; return toast(msgErro(e)); }
    btn.disabled = false;
    baixarCSV("bloqueios",
    ["id_entregador", "nome", "cidade", "tipo", "infracao", "ocorrencia", "ocorrencia_historico", "horas", "situacao", "inicio", "fim", "registrado_por", "tratativa", "tratativa_responsavel", "tratativa_concluida_em", "tratativa_nota", "liberado_antes_em", "motivo_liberacao", "revisar"],
    itens.map((b) => [b.id_app, b.nome, b.cidade, b.leve ? "leve" : "bloqueio", b.infracao, b.ocorrencia, b.ocorrencia_total, b.horas ?? "encerramento", SIT[b.situacao], b.inicio, b.fim, b.registrado_por_nome,
      b.tarefa ? (b.tarefa.status === "pendente" ? "pendente" : "realizada") : "sem tratativa", b.tarefa?.responsavel_nome, b.tarefa?.concluida_em, b.tarefa?.nota, b.liberado_em, b.motivo_liberacao, b.revisar]));
  });

  // ---------- regras (moderador) ----------
  function renderRegras() {
    const R = B.regras;
    if (!R) return;
    const linhas = R.infracoes.filter((i) => !i.leve).map((i) => linhaInfracao(i));
    linhas.push(linhaInfracao({ id: null, nome: "", horas_1a: null, horas_2a: null, terceira_encerra: false, fator: 1.3, janela_dias: null, ativa: true, previstas: [] }));
    $("#bq-t-regras").replaceChildren(
      el("thead", {}, el("tr", {}, ["Infração", "1ª (h)", "2ª (h)", "3ª encerra?", "Aumento da 3ª em diante", "Zera a contagem após", "Ativa", "Punições previstas (1ª → 5ª)", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, linhas));
    // infrações leves
    if (document.activeElement?.closest("#bq-f-leves") == null) { $("#bq-leves-limite").value = R.leves.limite; $("#bq-leves-janela").value = R.leves.janela_dias; }
    const normais = R.infracoes.filter((i) => !i.leve);
    $("#bq-t-leves").replaceChildren(
      el("thead", {}, el("tr", {}, ["Motivo", "Duração do aviso", "Ao atingir o limite, vira bloqueio de", "Ativa", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, [...R.infracoes.filter((i) => i.leve), { id: null, nome: "", horas_1a: 0.5, escala_para: null, ativa: true }].map((i) => {
        const nova = i.id == null;
        const nome = el("input", { type: "text", "aria-label": "Motivo", placeholder: nova ? "Novo motivo…" : "", maxlength: "150" }); nome.value = i.nome;
        const min = el("input", { type: "number", min: "1", max: "1440", "aria-label": "Duração em minutos" }); min.value = Math.round(Number(i.horas_1a) * 60);
        const esc = el("select", { "aria-label": "Infração normal gerada" }, el("option", { value: "", text: "Não gera bloqueio" }), ...normais.map((n) => el("option", { value: n.id, text: n.nome })));
        esc.value = i.escala_para ?? "";
        const at = el("input", { type: "checkbox", "aria-label": "Ativa" }); at.checked = i.ativa;
        return el("tr", {}, el("td", {}, nome), el("td", {}, min, " min"), el("td", {}, esc), el("td", {}, at),
          el("td", {}, el("button", { class: nova ? "btn small" : "btn primary small", type: "button", onclick: (e) => salvarLeve(i.id, nome.value, min.value, esc.value, at.checked, e.currentTarget) }, nova ? "Adicionar" : "Salvar")));
      })));
    if (document.activeElement?.closest("#bq-f-prazo") == null) $("#bq-prazo-horas").value = R.prazo_tratativa_horas ?? 32;
    $("#bq-t-cidades").replaceChildren(
      el("thead", {}, el("tr", {}, ["Cidade", "Gestão", "Recebe as tratativas"].map((h) => el("th", { text: h })))),
      el("tbody", {}, R.cidades.filter((c) => c.ativa).map((c) => el("tr", {}, el("td", { text: c.nome }),
        el("td", {}, el("span", { class: "gestao " + (c.gestao || "quero"), text: c.gestao === "operador" ? "Operador Logístico" : "Quero Delivery" })),
        el("td", {}, c.responsavel_valido ? c.responsavel_nome : "Moderadores",
          c.responsavel_email && !c.responsavel_valido ? el("div", { class: "alerta-revisar", text: `${c.responsavel_nome || c.responsavel_email} não é monitorador nos bloqueios: vai para os moderadores` }) : null)))));
  }
  function linhaInfracao(i) {
    const nova = i.id == null;
    const num = (v, rot, ph) => { const n = el("input", { type: "number", min: "1", step: "1", "aria-label": rot, placeholder: ph }); n.value = v ?? ""; return n; };
    const nome = el("input", { type: "text", "aria-label": "Nome da infração", placeholder: nova ? "Nova infração…" : "", maxlength: "150" }); nome.value = i.nome;
    const h1 = num(i.horas_1a, "Horas na 1ª ocorrência", "encerra"), h2 = num(i.horas_2a, "Horas na 2ª ocorrência", "encerra");
    const t3 = el("input", { type: "checkbox", "aria-label": "A 3ª ocorrência encerra a parceria" }); t3.checked = i.terceira_encerra;
    const fator = el("input", { type: "number", min: "0", max: "400", step: "5", "aria-label": "Aumento em % a partir da 3ª" }); fator.value = Math.round((Number(i.fator) - 1) * 100);
    const jan = num(i.janela_dias, "Zera a contagem após quantos dias sem ocorrência", "nunca");
    const at = el("input", { type: "checkbox", "aria-label": "Infração ativa" }); at.checked = i.ativa;
    return el("tr", {},
      el("td", {}, nome), el("td", {}, h1), el("td", {}, h2), el("td", {}, el("label", { class: "check" }, t3, "sim")),
      el("td", {}, fator, " %"), el("td", {}, jan, " dias"), el("td", {}, at),
      el("td", {}, el("div", { class: "chips" }, (i.previstas || []).map((h) => el("span", { class: "chip" + (h == null ? " x" : ""), text: h == null ? "encerra" : `${h} h` })))),
      el("td", {}, el("button", { class: nova ? "btn small" : "btn primary small", type: "button", onclick: (e) => salvarInfracao(i.id, {
        nome: nome.value, h1: h1.value, h2: h2.value, t3: t3.checked, fator: 1 + Number(fator.value || 0) / 100, jan: jan.value, ativa: at.checked }, e.currentTarget) }, nova ? "Adicionar" : "Salvar")));
  }
  async function salvarInfracao(id, v, btn) {
    btn.disabled = true;
    try {
      await rpc("salvar_infracao", { p_id: id, p_nome: v.nome, p_horas_1a: v.h1 ? Number(v.h1) : null, p_horas_2a: v.h2 ? Number(v.h2) : null,
        p_terceira_encerra: v.t3, p_fator: v.fator, p_janela_dias: v.jan ? Number(v.jan) : null, p_ativa: v.ativa });
      toast(id ? "Regra atualizada. Vale para os próximos bloqueios." : "Infração adicionada.");
      B.regras = await rpc("regras_bloqueio"); render();
    } catch (e) { toast(msgErro(e)); }
    finally { btn.disabled = false; }
  }
  async function salvarLeve(id, nome, minutos, escala, ativa, btn) {
    btn.disabled = true;
    try {
      await rpc("salvar_infracao_leve", { p_id: id, p_nome: nome, p_minutos: minutos ? Number(minutos) : null, p_escala_para: escala ? Number(escala) : null, p_ativa: ativa });
      toast(id ? "Infração leve atualizada." : "Motivo de infração leve adicionado.");
      B.regras = await rpc("regras_bloqueio"); render();
    } catch (e) { toast(msgErro(e)); }
    finally { btn.disabled = false; }
  }
  $("#bq-f-leves").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await rpc("salvar_parametros_leves", { p_limite: Number($("#bq-leves-limite").value), p_janela_dias: Number($("#bq-leves-janela").value) });
      toast("Regra das infrações leves atualizada."); document.activeElement?.blur();
      B.regras = await rpc("regras_bloqueio"); render();
    } catch (e) { toast(msgErro(e)); }
  });
  $("#bq-f-prazo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await rpc("salvar_prazo_tratativa", { p_horas: Number($("#bq-prazo-horas").value) });
      toast("Prazo da tratativa atualizado."); document.activeElement?.blur();
      B.regras = await rpc("regras_bloqueio"); await carregar();
    } catch (e) { toast(msgErro(e)); }
  });

  // ---------- entregadores de atenção ----------
  const MOTIVO_FILTRO = { leve: "leve do limite", reincidente: "reincidente", tipos: "tipos de infração", aprovado: "aprovado há pouco" };
  function renderAtencao() {
    const l = B.atencao, box = $("#bq-atencao-lista");
    if (!l) return box.replaceChildren(carregandoEl());
    const q = $("#bq-q-atencao").value, mt = $("#bq-atencao-motivo").value;
    const lista = l.filter((x) => (!q || norm([x.nome, x.id_app, x.cidade].join(" ")).includes(norm(q))) && (!mt || x.motivos.some((m) => m.includes(MOTIVO_FILTRO[mt]))));
    if (!l.length) return box.replaceChildren(vazio("Ninguém em atenção agora", "Quando um entregador chegar perto de uma punição maior, ele aparece aqui."));
    if (!lista.length) return box.replaceChildren(vazio("Nada com esse filtro", ""));
    box.replaceChildren(el("div", { class: "queue" }, lista.map((x) => el("article", { class: "card" },
      el("div", { class: "head" },
        el("span", { class: "name" }, linkFicha({ id_app: x.id_app, nome: x.nome || "ID " + x.id_app }), el("span", { class: "mono meta", text: x.id_app }),
          x.bloqueado_agora ? pillSit("bloqueado") : null),
        el("span", { class: "espera velho", text: `último registro ${dt(x.ultimo)}` })),
      el("div", { class: "motivos" }, x.motivos.map((m) => el("span", { text: m }))),
      el("div", { class: "meta", text: `${x.cidade || "Sem cidade"} · ${x.bloqueios} bloqueio(s) e ${x.leves} infração(ões) leve(s) contando agora` })))));
  }
  ["#bq-q-atencao", "#bq-atencao-motivo"].forEach((s) => $(s).addEventListener("input", () => renderAtencao()));

  // ---------- filtros que só redesenham ----------
  ["#bq-q-trat", "#bq-trat-cidade", "#bq-q-ativos", "#bq-ativos-cidade", "#bq-ativos-inf",
  ].forEach((s) => $(s).addEventListener("input", render));
  ["#bq-q-hist", "#bq-hist-sit", "#bq-hist-cidade", "#bq-hist-inf", "#bq-hist-quem", "#bq-hist-tipo"].forEach((s) => $(s).addEventListener("input", filtrarHist));

  App.bloqueios = { cardBloqueio, concluir, horasTxt, ord, B, TAREFA, realocar, abrirFicha, abrirRevisar };
  App.modulo({
    id: "bloqueios", nome: "Bloqueios",
    acesso: () => !!papel(),
    abas: [
      { id: "novo", nome: "Novo bloqueio", secao: "v-bq-novo" },
      { id: "tratativas", nome: "Tratativas", secao: "v-bq-tratativas", pode: staff, contador: "c-trat", alerta: true },
      { id: "ativos", nome: "Bloqueados agora", secao: "v-bq-ativos", pode: staff },
      { id: "atencao", nome: "Atenção", secao: "v-bq-atencao", contador: "c-atencao" },
      { id: "consultar", nome: "Consultar entregador", secao: "v-bq-consultar" },
      { id: "historico", nome: "Histórico", secao: "v-bq-historico" },
      { id: "regras", nome: "Regras", secao: "v-bq-regras", pode: mod },
    ],
    padrao: () => "novo",  // 008c: a primeira tela é o Novo bloqueio, depois as tratativas
    async carregar(aba) {
      const t = [];
      // regras e cidades: recarrega na aba Regras e a cada 5 min (alguém pode ter mudado)
      if (!B.regras || aba === "regras" || Date.now() - (B.regrasEm || 0) > 300000)
        t.push(rpc("regras_bloqueio").then((d) => { B.regras = d; B.regrasEm = Date.now(); }));
      if (aba === "tratativas") t.push(rpc("listar_tarefas", { p_status: B.tratVer }).then((d) => (B.tarefas[B.tratVer] = d)));
      if (aba === "ativos") t.push(rpc("listar_bloqueios", { p_escopo: "ativos" }).then((d) => (B.lista.ativos = d)));
      if (aba === "atencao") t.push(rpc("entregadores_atencao").then((d) => (B.atencao = d)));
      if (aba === "historico") t.push(carregarHist());
      await Promise.all(t);
    },
    render(aba) {
      ({ tratativas: renderTratativas, novo: renderNovo, ativos: renderAtivos, atencao: renderAtencao, consultar: renderConsulta,
         historico: renderHist, regras: renderRegras })[aba]?.();
    },
    contadores() {
      if (staff()) App.contador("c-trat", S.resumo?.bloqueios?.tratativas_pendentes || 0);
      App.contador("c-atencao", S.resumo?.bloqueios?.atencao || 0);
    },
  });
})();
