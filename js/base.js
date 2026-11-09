// Base do app: utilidades, login, rotas entre módulos e carregamento comum.
// Cada módulo (js/inicio.js, js/ativacao.js, js/bloqueios.js, js/atividades.js, js/equipe.js)
// se registra com App.modulo({...}); este arquivo decide qual tela mostrar e quando recarregar.
(() => {
  "use strict";
  const App = (window.App = { modulos: {}, ordem: [], aoEntrar: [] });

  // ---------- utilidades ----------
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
  const fmtCPF = (d) => { d = onlyDigits(d).slice(0, 11); return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); };
  function cpfValido(c) {
    c = onlyDigits(c);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let s = 0;
      for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
    }
    return true;
  }
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const dt = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const dia = (iso) => new Date(iso + (String(iso).length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  function duracao(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (min < 60) return { txt: `${min} min`, velho: false };
    const h = Math.round(min / 60);
    if (h < 24) return { txt: `${h} h`, velho: h >= 12 };
    const d = Math.round(h / 24);
    return { txt: `${d} dia${d > 1 ? "s" : ""}`, velho: true };
  }
  const num = (v) => (v == null ? "—" : String(v));
  const horas = (h) => h == null ? "—" : h < 1 ? Math.round(h * 60) + " min" : String(h).replace(".", ",") + " h";
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 4000); }
  function notice(msg) { const n = $("#notice"); n.textContent = msg || ""; n.hidden = !msg; }

  const CIDADES = ["ITABAIANA - SE","LAGARTO - SE","SERRINHA - BA","PAULO AFONSO - BA","TOBIAS BARRETO - SE","SALGADO - SE","SIMÃO DIAS - SE","CÍCERO DANTAS - BA","ITABERABA - BA","ALAGOINHAS - BA","ARCOVERDE - PE","CARPINA - PE","SANTA CRUZ DO CAPIBARIBE - PE","POJUCA - BA","CANDEIAS - BA","ESCADA - PE","BELO JARDIM - PE","VITÓRIA DE SANTO ANTÃO - PE","GRAVATÁ - PE","RECIFE - PE","RIACHÃO DO DANTAS - SE","SÃO LOURENÇO DA MATA - PE","PAULISTA - PE","RIBEIRA DO POMBAL - BA","POÇO VERDE - SE","PALMEIRA DOS ÍNDIOS - AL","ESTÂNCIA - SE","CABO DE SANTO AGOSTINHO - PE","BUÍQUE - PE","CAPELA - SE"];
  const ST = {
    aguardando_analise: "Aguardando análise",
    aguardando_contato: "Aguardando novo contato e documentação",
    aprovado: "Aprovado",
    encerrado: "Encerrado",
  };
  const PAPEL = { moderador: "Moderador", monitorador: "Monitorador", suporte: "Suporte" };
  const EVENTO = { enviado: "Enviado", aprovado: "Aprovado", reprovado: "Reprovado", encerrado: "Encerrado", desfeito: "Decisão desfeita", editado: "Dados alterados", revisado: "Dados conferidos" };
  const pill = (s, curto) => el("span", { class: "pill " + s, text: curto && s === "aguardando_contato" ? "Aguardando novo contato" : ST[s] });
  const titulo = (c) => c.id_app ? "ID " + c.id_app : "CPF " + fmtCPF(c.cpf);
  const vazio = (t, d) => el("div", { class: "empty" }, el("strong", { text: t }), d);
  const carregandoEl = () => vazio("Carregando…");

  // ---------- estado comum ----------
  const S = (App.S = {
    sb: null, me: null, motivos: { reprovacao: [], encerramento: [] }, pessoas: [],
    resumo: null, notif: null, equipe: null, confirmar: {},
  });
  const papelAtiv = () => S.me?.papel;
  const papelBloq = () => S.me?.papel_bloqueios;

  async function rpc(fn, args) {
    const { data, error } = await S.sb.rpc(fn, args);
    if (error) throw error;
    return data;
  }
  const msgErro = (e) => e?.message && !/fetch|network/i.test(e.message) ? e.message : "Não foi possível falar com o servidor. Tente de novo em instantes.";

  // tabela simples: cols = [[título, numérico?]], linhas = <tr>s
  const tabela = (cols, linhas, vazioTxt) => [
    el("thead", {}, el("tr", {}, cols.map(([t, n]) => el("th", { class: n ? "num" : null, text: t })))),
    el("tbody", {}, linhas.length ? linhas : el("tr", {}, el("td", { colspan: cols.length, class: "meta", text: vazioTxt })))];
  // barras horizontais: lista de { rotulo, qtd, extra }
  const barras = (lista, cor, vazioTxt) => {
    const mx = Math.max(1, ...lista.map((x) => x.qtd));
    return lista.length ? lista.map((x) => el("div", { style: "display:grid;gap:4px;margin-bottom:10px" },
      el("div", { style: "display:flex;justify-content:space-between;gap:8px;font-size:14px" }, el("span", { text: x.rotulo }), el("strong", { style: "font-variant-numeric:tabular-nums", text: x.extra ?? x.qtd })),
      el("div", { class: "bar" }, el("span", { style: `width:${(x.qtd / mx) * 100}%;background:${cor}` }))))
      : [el("p", { class: "meta", text: vazioTxt })];
  };
  // gráfico de barras empilhadas por dia. series = [[chave, cor, nome]]; pontos = [chave, cor, nome] opcional
  function grafico(data, series, pontos, rotuloAria) {
    const max = Math.max(1, ...data.map((x) => Math.max(series.reduce((s, [k]) => s + (x[k] || 0), 0), pontos ? x[pontos[0]] || 0 : 0)));
    const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step;
    const W = 700, H = 230, Lm = 30, B = 26, T = 22, cw = (W - Lm - 6) / data.length, bw = Math.min(26, cw * 0.58);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", rotuloAria);
    const add = (tag, at, txt) => { const n = document.createElementNS(ns, tag); for (const k in at) n.setAttribute(k, at[k]); if (txt != null) n.textContent = txt; svg.append(n); return n; };
    const tip = (n, t) => n.append(Object.assign(document.createElementNS(ns, "title"), { textContent: t }));
    for (let v = 0; v <= top; v += step) { add("line", { x1: Lm, x2: W - 4, y1: y(v), y2: y(v), class: "grid" }); add("text", { x: Lm - 6, y: y(v) + 4, "text-anchor": "end" }, v); }
    const cada = Math.max(1, Math.ceil(data.length / 8));
    data.forEach((x, i) => {
      const cx = Lm + cw * i + cw / 2; let base = 0;
      for (const [k, cor, nome] of series) {
        if (!x[k]) continue;
        tip(add("rect", { x: cx - bw / 2, y: y(base + x[k]), width: bw, height: y(base) - y(base + x[k]), fill: cor }), `${dia(x.dia)}: ${x[k]} ${nome}`);
        base += x[k];
      }
      if (pontos && x[pontos[0]]) tip(add("circle", { cx, cy: y(x[pontos[0]]), r: 4, fill: pontos[1], stroke: "var(--surface)", "stroke-width": 1.5 }), `${dia(x.dia)}: ${x[pontos[0]]} ${pontos[2]}`);
      if ((data.length - 1 - i) % cada === 0) add("text", { x: cx, y: H - 8, "text-anchor": "middle" }, dia(x.dia));
    });
    return svg;
  }
  function baixarCSV(nome, cols, linhas) {
    const esc = (x) => { x = x == null ? "" : String(x); return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const url = URL.createObjectURL(new Blob(["\uFEFF" + [cols.join(";"), ...linhas.map((l) => l.map(esc).join(";"))].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = el("a", { href: url, download: `${nome}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // segmentos "Todos / Só eu / Escolher pessoas": devolve null (todos) ou lista de ids
  function filtroPessoas(estado) {
    if (estado.filtro === "eu") return [S.me.id];
    if (estado.filtro === "escolher") return estado.escolhidos.size ? [...estado.escolhidos] : [S.me.id];
    return null;
  }
  function caixaPessoas(box, estado, aoMudar) {
    box.hidden = estado.filtro !== "escolher";
    if (box.hidden) return;
    box.replaceChildren(...S.pessoas.map((p) => {
      const cb = el("input", { type: "checkbox", value: p.id, onchange: (e) => { if (e.target.checked) estado.escolhidos.add(p.id); else estado.escolhidos.delete(p.id); aoMudar(); } });
      cb.checked = estado.escolhidos.has(p.id);
      return el("label", {}, cb, p.id === S.me.id ? `${p.nome} (você)` : p.nome);
    }));
  }
  const nomesEscolhidos = (estado) => S.pessoas.filter((p) => estado.escolhidos.has(p.id)).map((p) => (p.id === S.me.id ? "você" : p.nome)).join(", ");

  // janela por cima da tela (correções, edição). Fecha com Esc, com o ✕ ou com d.close().
  function janela(titulo, ...conteudo) {
    const d = el("dialog", { class: "janela", "aria-label": titulo },
      el("div", { class: "janela-topo" }, el("h3", { text: titulo }),
        el("button", { class: "btn link", type: "button", "aria-label": "Fechar", onclick: () => d.close() }, "✕")),
      ...conteudo);
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
    return d;
  }

  // previsão de término de uma tarefa (cadastro, tratativa, atividade): linha + botão que abre a janela.
  // item: { previsao, previsao_por_nome }; tipo: 'cadastro' | 'tarefa' | 'atividade'; pode: quem está com a tarefa
  const paraCampo = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
  function previsao(item, tipo, id, pode) {
    const p = item?.previsao ? new Date(item.previsao) : null;
    const passou = p && p < Date.now();
    if (!p && !pode) return null;
    const hoje = p && p.toDateString() === new Date().toDateString();
    const quando = p ? (hoje ? "hoje às " + p.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : dt(p.toISOString())) : null;
    return el("div", { class: "previsao" + (passou ? " passou" : "") },
      p ? el("span", {}, el("b", { text: passou ? `Previsão passou (${quando})` : `Previsão: até ${quando}` }), item.previsao_por_nome ? ` · por ${item.previsao_por_nome}` : "") : null,
      pode ? el("button", { class: "btn link", type: "button", onclick: (e) => { e.stopPropagation(); abrirPrevisao(item, tipo, id); } }, p ? "Alterar previsão" : "Informar previsão de término") : null);
  }
  function abrirPrevisao(item, tipo, id) {
    const campo = el("input", { type: "datetime-local" });
    const base = item?.previsao ? new Date(item.previsao) : new Date(Date.now() + 2 * 3600000);
    campo.value = paraCampo(base);
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const atalho = (rot, f) => el("button", { class: "chip", type: "button", onclick: () => { campo.value = paraCampo(f()); } }, rot);
    const em = (h) => () => new Date(Date.now() + h * 3600000);
    const as = (dias, hora) => () => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(hora, 0, 0, 0); return d; };
    async function salvar(btn, valor) {
      erro.hidden = true; btn.disabled = true;
      try { await rpc("definir_previsao", { p_tipo: tipo, p_id: id, p_previsao: valor }); d.close(); toast(valor ? "Previsão informada." : "Previsão removida."); App.carregar(); }
      catch (e) { btn.disabled = false; erro.textContent = msgErro(e); erro.hidden = false; }
    }
    const d = janela("Previsão de término",
      el("p", { class: "meta", style: "margin:0", text: "Até quando você termina esta tarefa? Quem acompanha vê a previsão. É só informativa: não muda prazos nem avisos." }),
      el("div", { class: "chips" }, atalho("+1 h", em(1)), atalho("+2 h", em(2)), atalho("+4 h", em(4)), atalho("Hoje 18:00", as(0, 18)), atalho("Amanhã 12:00", as(1, 12))),
      el("label", {}, "Termina até", campo),
      erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => { if (!campo.value) { erro.textContent = "Escolha o dia e a hora."; erro.hidden = false; return; } salvar(e.currentTarget, new Date(campo.value).toISOString()); } }, "Salvar"),
        item?.previsao ? el("button", { class: "btn", type: "button", onclick: (e) => salvar(e.currentTarget, null) }, "Remover previsão") : null,
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }

  App.u = { $, el, janela, previsao, onlyDigits, fmtCPF, cpfValido, norm, dt, dia, duracao, num, horas, toast, notice, CIDADES, ST, PAPEL, EVENTO, pill, titulo,
            vazio, carregandoEl, rpc, msgErro, tabela, barras, grafico, baixarCSV, filtroPessoas, caixaPessoas, nomesEscolhidos, papelAtiv, papelBloq };

  // ---------- módulos e rotas ----------
  // Rotas: #modulo/aba (ex.: #bloqueios/novo). As antigas (#pendentes, #novo...) continuam valendo para a ativação.
  App.modulo = (def) => { App.modulos[def.id] = def; App.ordem.push(def.id); };
  const ANTIGAS = { pendentes: 1, novo: 1, meus: 1, painel: 1, historico: 1 };
  const APELIDOS = { "ativacao/meus": "ativacao/historico", "ativacao/painel": "analises/simples",
                     "bloqueios/meus": "bloqueios/historico", "bloqueios/painel": "analises/simples" };
  const abasPermitidas = (m) => m.abas.filter((a) => !a.pode || a.pode());
  App.atual = { mod: null, aba: null };
  // Grupos: módulos que aparecem juntos sob um item só do menu, com uma segunda barra para escolher entre eles.
  // As rotas continuam as de cada módulo (#ativacao/..., #bloqueios/...), então links antigos e avisos seguem valendo.
  App.grupos = {
    entregadores: { nome: "Entregadores", membros: [
      { mod: "ativacao", nome: "Ativação", contador: "c-pend" },
      { mod: "bloqueios", nome: "Bloqueios", contador: "c-trat", alerta: true },
      { mod: "entregadores", nome: "Cadastrar entregador" }],
      // número no item do menu de cima: o que está esperando pela pessoa dentro do grupo
      aviso: () => App.valores["c-trat"] || 0 },
  };
  const grupoDe = (id) => Object.keys(App.grupos).find((g) => App.grupos[g].membros.some((m) => m.mod === id));
  const podeMod = (id) => { const d = App.modulos[id]; return !!d && (!d.acesso || d.acesso()); };
  const ultimoDoGrupo = {};
  function lerRota() {
    let [m, a] = location.hash.replace("#", "").split("/");
    if (ANTIGAS[m] && !a) { a = m; m = "ativacao"; }
    return { m: m || "inicio", a };
  }
  function route() {
    if (!S.me) return;
    let { m, a } = lerRota();
    // links dos avisos: #ficha/<ID> abre a ficha; #cadastro/<id> abre o cadastro por cima da tela atual
    if ((m === "ficha" || m === "cadastro") && a) {
      const alvo = decodeURIComponent(a);
      history.replaceState(null, "", m === "ficha" ? "#bloqueios/consultar" : App.atual.mod ? `#${App.atual.mod}/${App.atual.aba}` : "#inicio");
      route();
      if (m === "ficha") App.abrirFicha?.(alvo); else App.abrirCadastro?.(alvo);
      return;
    }
    // 008c: telas que foram juntadas a outras continuam abrindo (links antigos, favoritos)
    const ap = APELIDOS[`${m}/${a}`];
    if (ap) { history.replaceState(null, "", "#" + ap); [m, a] = ap.split("/"); }
    let mod = App.modulos[m];
    if (!mod || (mod.acesso && !mod.acesso())) mod = App.modulos.inicio;
    const abas = abasPermitidas(mod);
    let aba = abas.find((x) => x.id === a) || abas.find((x) => x.id === mod.padrao?.()) || abas[0];
    App.atual = { mod: mod.id, aba: aba.id };
    document.querySelectorAll("section.view").forEach((s) => (s.hidden = s.id !== aba.secao));
    // menu de módulos (um item de grupo vale para todos os módulos dele)
    const grupo = grupoDe(mod.id);
    if (grupo) ultimoDoGrupo[grupo] = `#${mod.id}/${aba.id}`;
    document.querySelectorAll("nav.modulos a").forEach((x) => {
      const g = x.dataset.grupo;
      if (g) {
        const membros = App.grupos[g].membros.filter((m) => podeMod(m.mod));
        x.hidden = !membros.length;
        x.href = ultimoDoGrupo[g] || (membros[0] ? "#" + membros[0].mod : "#inicio");
      } else x.hidden = !podeMod(x.dataset.mod);
      if ((g || x.dataset.mod) === (grupo || mod.id)) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current");
    });
    // segunda barra do grupo
    const ng = $("nav.grupo");
    ng.hidden = !grupo;
    ng.replaceChildren(...(grupo ? App.grupos[grupo].membros.filter((m) => podeMod(m.mod)).map((m) =>
      el("a", { href: "#" + m.mod, "data-grupo-mod": m.mod, "aria-current": m.mod === mod.id ? "page" : null }, m.nome,
        m.contador ? el("span", { class: "count" + (m.alerta ? " alert" : ""), "data-espelho": m.contador, hidden: true, text: "0" }) : null)) : []));
    // abas do módulo
    const nav = $("nav.tabs");
    nav.hidden = abas.length < 2;
    nav.setAttribute("aria-label", "Telas de " + mod.nome);
    nav.replaceChildren(...abas.map((x) => el("a", { href: `#${mod.id}/${x.id}`, "data-view": x.id, "aria-current": x.id === aba.id ? "page" : null },
      x.nome, x.contador ? el("span", { class: "count" + (x.alerta ? " alert" : ""), id: x.contador, hidden: true, text: "0" }) : null)));
    App.render();
    App.carregar();
  }
  App.route = route;
  addEventListener("hashchange", route);

  // ---------- carregar e desenhar ----------
  let carregando = null, deNovo = false;
  App.carregar = async function carregar() {
    if (!S.me) return;
    if (carregando) { deNovo = true; return carregando; }
    carregando = (async () => {
      // tarefas periódicas (sem serviço agendado: quem abre o app dispara)
      if (Date.now() - ultimaRotina > 300000) {
        ultimaRotina = Date.now();
        if (papelBloq()) rpc("verificar_atrasos").catch((e) => console.error("verificar_atrasos", e));
        rpc("verificar_previsoes").catch((e) => console.error("verificar_previsoes", e));
        rpc("verificar_tarefas").catch((e) => console.error("verificar_tarefas", e));
        rpc("gerar_recorrentes").catch((e) => console.error("gerar_recorrentes", e));  // 009d3: tarefas que se repetem  // 009d2: sem dono na metade do prazo / atrasadas  // 008d: só olha as previsões de quem chamou
        rpc("pessoas").then((d) => (S.pessoas = d)).catch(() => {});
      }
      const mod = App.modulos[App.atual.mod];
      // cada consulta independente: uma falha não apaga as outras, e o aviso diz qual falhou
      // resumo + avisos numa chamada só; a lista da equipe só na tela Equipe (menos tráfego)
      const r = await Promise.allSettled([
        mod?.carregar?.(App.atual.aba),
        rpc("resumo_e_avisos").then((d) => { S.resumo = d.resumo; S.notif = d.notif; if (d.resumo?.versao != null) versao = Number(d.resumo.versao); }),
        papelAtiv() === "moderador" && App.atual.mod === "equipe" ? rpc("listar_equipe").then((d) => (S.equipe = d)) : null,
      ]);
      ultimaCompleta = Date.now();
      const nomes = ["tela atual", "resumo_e_avisos", "listar_equipe"];
      const falhas = r.map((x, i) => (x.status === "rejected" ? [nomes[i], x.reason] : null)).filter(Boolean);
      falhas.forEach(([n, e]) => console.error("Falha em", n, e));
      if (!falhas.length) notice("");
      else if (falhas.some(([, e]) => e?.code === "42501")) notice("Seu acesso mudou. Recarregue a página.");
      else if (falhas.every(([, e]) => /fetch|network/i.test(e?.message || ""))) notice("Não foi possível atualizar os dados. Verifique a internet; a página tenta de novo sozinha.");
      else notice("Erro ao carregar dados (" + falhas.map(([n, e]) => `${n}: ${e?.message || e}`).join(" · ") + "). Mande um print desta mensagem para o suporte do sistema.");
      // o acesso da pessoa mudou (Equipe): atualiza papéis, abas e telas sem precisar recarregar
      const R = S.resumo;
      if (R && "papel" in R && (R.papel !== S.me.papel || R.papel_bloqueios !== S.me.papel_bloqueios)) {
        try { const me = await rpc("entrar"); if (me.membro) { S.me = me; mostrarPapel(); toast("Seu acesso foi atualizado."); route(); } } catch (_) {}
      }
      App.render();
    })();
    await carregando;
    carregando = null;
    if (deNovo) { deNovo = false; App.carregar(); }
  };
  let ultimaRotina = 0;
  // Menos tráfego: a cada ciclo o app só pergunta o número da última mudança (barato) e recarrega as
  // listas quando ele mudou. Coisas que mudam só com o tempo (prazo que venceu, tratativa que atrasou)
  // não mudam o número: por isso recarrega tudo a cada 5 min. Sem mexer no mouse/teclado por 5 min,
  // o ciclo passa de 30 s para 2 min; com a aba escondida, não atualiza.
  let versao = null, ultimaCompleta = 0, ultimoTique = 0, mexeuEm = Date.now();
  for (const ev of ["pointermove", "keydown", "touchstart", "scroll", "focusin"]) addEventListener(ev, () => (mexeuEm = Date.now()), { passive: true, capture: true });
  // Versão nova publicada: quem está com o app aberto há muito tempo continua com os arquivos antigos
  // (a página não recarrega sozinha). Ao voltar para a aba (no máximo uma vez a cada 5 min) e, com a aba aberta, a cada 30 min, o app confere o versao.txt
  // do site e, se mudou, mostra um aviso com "Atualizar agora". VERSAO_APP = o conteúdo do versao.txt
  // desta publicação (trocar os dois juntos, com o ?v= do index.html).
  const VERSAO_APP = "009g3";
  let versaoConferida = 0;
  async function conferirVersao(forcar = false) {
    if (!forcar && Date.now() - versaoConferida < 300000) return;
    versaoConferida = Date.now();
    try {
      const r = await fetch("versao.txt?t=" + Date.now(), { cache: "no-store" });
      const v = r.ok ? (await r.text()).trim() : "";
      if (v && v !== VERSAO_APP && !document.getElementById("aviso-versao")) {
        document.body.append(el("div", { class: "aviso-versao", id: "aviso-versao", role: "status" },
          el("span", { text: "Saiu uma versão nova do Comunique." }),
          el("button", { class: "btn primary small", type: "button", onclick: () => location.reload() }, "Atualizar agora"),
          el("button", { class: "btn link", type: "button", onclick: (e) => e.currentTarget.parentElement.remove() }, "Depois")));
      }
    } catch (_) {}
  }
  App.conferirVersao = conferirVersao;
  async function tique() {
    if (Date.now() - versaoConferida > 1800000) conferirVersao();  // aba aberta o tempo todo: confere a cada 30 min
    if (document.hidden || !S.me) return;
    if (Date.now() - mexeuEm > 300000 && Date.now() - ultimoTique < 120000) return;
    ultimoTique = Date.now();
    if (versao != null && Date.now() - ultimaCompleta < 300000) {
      try { const v = await rpc("ultima_mudanca"); if (v != null && Number(v) === versao) { App.render(); return; } } catch (_) {}
    }
    App.carregar();
  }
  App.tique = tique;
  let agendado = null;
  const agendar = () => { clearTimeout(agendado); agendado = setTimeout(App.carregar, 400); };

  let adiado = false;
  App.render = function render() {
    if (!S.me) return;
    const mod = App.modulos[App.atual.mod];
    const sec = $("#" + mod.abas.find((x) => x.id === App.atual.aba)?.secao);
    // não redesenha enquanto a pessoa digita dentro de listas que se redesenham (perderia o foco)
    const ativo = document.activeElement;
    if (ativo && sec?.contains(ativo) && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName) && ativo.closest(".protege-foco")) { adiado = true; return; }
    adiado = false;
    // contadores de todos os módulos
    for (const id of App.ordem) App.modulos[id].contadores?.();
    for (const [g, def] of Object.entries(App.grupos)) if (def.aviso) App.contador("c-grupo-" + g, def.aviso());
    const nPed = S.resumo?.pedidos_acesso ?? S.equipe?.pedidos?.length ?? 0;
    $("#c-pedidos").textContent = nPed; $("#c-pedidos").hidden = !nPed;
    const nAv = S.notif?.nao_lidas || 0;
    $("#c-avisos").textContent = nAv ? `🔔 ${nAv}` : "🔔";
    $("#b-avisos").dataset.novas = String(nAv > 0);
    $("#b-avisos").setAttribute("aria-label", nAv ? `${nAv} aviso(s) novo(s)` : "Avisos");
    mod.render?.(App.atual.aba);
  };
  document.addEventListener("focusout", () => setTimeout(() => { if (adiado) App.render(); }, 0));
  const carregar = () => App.carregar();
  App.valores = {};
  App.contador = (id, n) => {
    App.valores[id] = n;
    const c = document.getElementById(id);
    if (c) { c.textContent = n; c.hidden = !n; }
    document.querySelectorAll(`[data-espelho="${id}"]`).forEach((x) => { x.textContent = n; x.hidden = !n; });
  };

  // ---------- login ----------
  function gate(estado, extra = "") {
    const g = $("#gate");
    g.hidden = !estado;
    if (!estado) return;
    const txt = {
      config: "O app ainda não está ligado ao banco de dados. Preencha o arquivo supabase-config.js (veja SUPABASE.md).",
      carregando: "Carregando…",
      entrar: "Entre com sua conta Google para usar o sistema.",
      sem: `A conta ${extra} ainda não tem acesso. Peça acesso: um moderador vai liberar e escolher o seu tipo de acesso.`,
      pedido: `Pedido de acesso enviado para ${extra}. Assim que um moderador liberar, recarregue esta página.`,
    }[estado];
    $("#gate-txt").textContent = txt;
    $("#g-entrar").hidden = true;   // quem decide entre o botão do Google e o de reserva é botaoGoogle()
    $("#g-google").hidden = estado !== "entrar";
    $("#g-pedir").hidden = estado !== "sem";
    $("#g-trocar").hidden = !["sem", "pedido"].includes(estado);
  }
  function gateErro(m) { $("#gate-erro").textContent = m || ""; $("#gate-erro").hidden = !m; }

  // Login com o botão oficial do Google (Google Identity Services): a janela do Google mostra o
  // endereço do site, não o do Supabase. O Google devolve um token, que o Supabase confere.
  // Se o botão não carregar (ou faltar o GOOGLE_CLIENT_ID), usa o login por redirecionamento do Supabase.
  const GOOGLE_ID = window.GOOGLE_CLIENT_ID && !/COLE/.test(window.GOOGLE_CLIENT_ID) ? window.GOOGLE_CLIENT_ID : null;
  async function esperarGIS(ms = 6000) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (window.google?.accounts?.id) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  }
  function pedirLogin() { gate("entrar"); botaoGoogle(); }
  async function botaoGoogle() {
    const alvo = $("#g-google");
    if (!GOOGLE_ID || !(await esperarGIS())) { alvo.hidden = true; $("#g-entrar").hidden = false; return; }
    // nonce: o Google recebe o hash; o Supabase recebe o valor original e confere que batem
    const bruto = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bruto)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    google.accounts.id.initialize({
      client_id: GOOGLE_ID, nonce: hash, ux_mode: "popup", context: "signin", use_fedcm_for_prompt: true,
      callback: async (resp) => {
        gateErro(""); gate("carregando");
        const { error } = await S.sb.auth.signInWithIdToken({ provider: "google", token: resp.credential, nonce: bruto });
        if (error) { pedirLogin(); return gateErro("Não foi possível entrar: " + error.message); }
        posLogin();
      },
    });
    alvo.replaceChildren();
    google.accounts.id.renderButton(alvo, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", locale: "pt-BR" });
    alvo.hidden = false;
  }
  const sair = () => { try { window.google?.accounts?.id?.disableAutoSelect(); } catch (_) {} S.sb.auth.signOut(); };

  async function iniciar() {
    if (!window.supabase || !window.SUPABASE_URL || /COLE/.test(window.SUPABASE_URL)) return gate("config");
    S.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { flowType: "pkce" } });
    S.sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") location.replace(location.pathname); });
    $("#g-entrar").addEventListener("click", async () => {
      gateErro("");
      const { error } = await S.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
      if (error) gateErro("Não foi possível abrir o login do Google: " + error.message);
    });
    $("#g-trocar").addEventListener("click", sair);
    $("#b-sair").addEventListener("click", sair);
    $("#g-pedir").addEventListener("click", async (e) => {
      const bt = e.currentTarget; bt.disabled = true;
      try { await rpc("pedir_acesso"); gate("pedido", S.email); } catch (err) { gateErro(msgErro(err)); bt.disabled = false; }
    });

    const { data: { session } } = await S.sb.auth.getSession();
    if (!session) return pedirLogin();
    posLogin();
  }

  // papel no topo: um só quando é igual nos dois módulos; senão, os dois
  function mostrarPapel() {
    const a = S.me.papel, b = S.me.papel_bloqueios;
    $("#papel").textContent = !b || a === b ? PAPEL[a] + (b ? "" : " (ativação)") : `Ativação: ${PAPEL[a]} · Bloqueios: ${PAPEL[b]}`;
    $("#papel").hidden = false;
  }

  async function posLogin() {
    let r;
    try { r = await rpc("entrar"); }
    catch (e) { pedirLogin(); return gateErro(msgErro(e)); }
    S.email = r.email;
    if (!r.membro) return gate(r.pedido ? "pedido" : "sem", r.email);

    S.me = r;
    $("#who").textContent = r.nome;
    mostrarPapel();
    $("#b-sair").hidden = false; $("#b-avisos").hidden = false;
    gate(null);
    try { [S.motivos, S.pessoas] = await Promise.all([rpc("listar_motivos"), rpc("pessoas")]); } catch (_) {}
    for (const m of App.ordem) { try { App.modulos[m].iniciar?.(); } catch (e) { console.error(e); } }
    route();
    for (const f of App.aoEntrar) { try { f(); } catch (e) { console.error(e); } }

    // tempo real (008c): só os avisos da própria pessoa (o RLS manda só os dela), para o sino acender na hora.
    // O resto chega pelo tique (a cada 30 s pergunta só o número da última mudança): antes, cada mudança em
    // 8 tabelas fazia todo mundo recarregar tudo na hora, por cima do tique.
    try {
      S.sb.channel("avisos").on("postgres_changes", { event: "INSERT", schema: "public", table: "notificacoes", filter: `para=eq.${S.me.id}` }, (payload) => {
        try { App.som?.aviso(payload?.new); } catch (_) {}  // 009d: som conforme a urgência
        agendar();
      }).subscribe();
    } catch (_) {}
    setInterval(tique, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { ultimoTique = 0; conferirVersao(); tique(); } });
  }
  gate("carregando");
  addEventListener("DOMContentLoaded", iniciar);
})();
