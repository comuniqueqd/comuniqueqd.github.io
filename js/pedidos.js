// 009z6 "Pedidos fora do limite" (aba das Restrições). Os pedidos vêm dos arquivos baixados do Tableau, lidos e
// juntados AQUI, no navegador: "Entregas por Loja (com tempo)" (as etapas), "Resumo filtro" (o nome do entregador) e
// "Tempo de entrega dos entregadores" (o ID de cada nome). Só vão para o banco os campos de que a tela precisa; nada
// do cliente. O banco calcula os sinais (supabase/009z6-pedidos-fora-do-limite.sql) e nada vira restrição sozinho.
(() => {
  const App = window.App;
  const { $, el, janela, norm, dt, toast, vazio, carregandoEl, rpc, msgErro, copiavel } = App.u;
  const S = App.S;
  const P = { dados: null, filtros: { de: "", ate: "", cidade: "", loja: "", busca: "", tipo: "atrasos", situacao: "a_decidir" }, limite: 50, leitura: null, enviando: false };
  const papel = () => S.me?.papel_bloqueios;
  const mod = () => papel() === "moderador";
  const plural = (n, um, varios) => App.u.plural(n, um, varios);

  // ---------- leitura dos arquivos ----------
  function decodificar(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
    if (b.length > 3 && b[1] === 0 && b[3] === 0) return new TextDecoder("utf-16le").decode(b);
    return new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");
  }
  // CSV/TSV com aspas ("" = aspas dentro do campo). O Tableau usa tabulação.
  function linhas(txt) {
    const primeira = txt.slice(0, txt.indexOf("\n") >>> 0);
    const sep = primeira.includes("\t") ? "\t" : primeira.split(";").length > primeira.split(",").length ? ";" : ",";
    const out = []; let row = [], cel = "", aspas = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (aspas) {
        if (c === '"') { if (txt[i + 1] === '"') { cel += '"'; i++; } else aspas = false; } else cel += c;
      } else if (c === '"' && cel === "") aspas = true;
      else if (c === sep) { row.push(cel); cel = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && txt[i + 1] === "\n") i++;
        row.push(cel); cel = ""; if (row.length > 1 || row[0] !== "") out.push(row); row = [];
      } else cel += c;
    }
    if (cel !== "" || row.length) { row.push(cel); out.push(row); }
    return out;
  }
  // "10/11/2026 12:15:28" (horário de Brasília) → ISO com -03:00
  const quando = (v) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec((v || "").trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || "00"}-03:00` : null;
  };
  // "SE - LAGARTO" → "LAGARTO - SE" (como as cidades do Comunique)
  const cidadeComunique = (v) => {
    const m = /^\s*([A-Za-z]{2})\s*-\s*(.+?)\s*$/.exec(v || "");
    return m ? `${m[2].toUpperCase()} - ${m[1].toUpperCase()}` : (v || "").trim().toUpperCase() || null;
  };
  const nomeChave = (s) => norm(s || "").toUpperCase().replace(/\s+/g, " ").trim();
  const titulo = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());

  // acha a linha de cabeçalho (o Tableau às vezes põe uma linha antes) e diz que arquivo é
  function tipoArquivo(rows) {
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const h = rows[i].map((x) => x.trim());
      const tem = (n) => h.includes(n);
      if (tem("Entrega Id") && tem("Solicitado At")) return { tipo: "etapas", h, i };
      if (tem("Entrega Id") && tem("Entregador")) return { tipo: "resumo", h, i };
      if (h[0]?.startsWith("entregadorId") && tem("Nome")) return { tipo: "entregadores", h, i };
    }
    return null;
  }

  // arquivos: [{ nome, texto }] → { pedidos, avisos[], resumo }
  function ler(arquivos) {
    const dist = new Map();
    const avisos = [], etapas = new Map(), nomes = new Map(), bairrosR = new Map(), ids = new Map(), lidos = { etapas: 0, resumo: 0, entregadores: 0 };
    const porArquivo = [];   // 009z6d: o que cada arquivo trouxe, para a lista da tela
    for (const a of arquivos) {
      const rows = linhas(a.texto), t = tipoArquivo(rows);
      if (!t) { porArquivo.push({ nome: a.nome, tipo: null }); avisos.push(`"${a.nome}" não é um dos arquivos esperados: confira se baixou a planilha certa (Tabela de referência cruzada).`); continue; }
      lidos[t.tipo]++;
      const antes = { etapas: etapas.size, resumo: nomes.size, entregadores: ids.size };
      const ix = (n) => t.h.indexOf(n);
      const corpo = rows.slice(t.i + 1);
      if (t.tipo === "etapas") {
        const c = Object.fromEntries(["Entrega Id", "Código", "UF - Cidade", "Estabelecimento", "estabelecimentoId", "createdAt (pedido)", "Solicitado At",
          "associadoAt", "Aceite At", "Chegou Loja At", "Saiu Loja At", "Entregue At", "Finalizado At", "Bairro da Entrega"].map((n) => [n, ix(n)]));
        const lojas = new Set();
        for (const r of corpo) {
          const id = (r[c["Entrega Id"]] || "").trim();
          // o Tableau repete a linha uma vez por medida; a da distância traz "Rota Distancia (metros)" e o valor ao lado
          const im = r.indexOf("Rota Distancia (metros)");
          if (id && im >= 0) { const m = Number((r[im + 1] || "").replace(/\./g, "").replace(",", ".")); if (Number.isFinite(m)) dist.set(id, Math.round(m)); }
          if (!id || id === "Total" || etapas.has(id)) continue;
          const g = (n) => (c[n] >= 0 ? quando(r[c[n]]) : null);
          const aceites = [g("associadoAt"), g("Aceite At")].filter(Boolean).sort();
          lojas.add(r[c["Estabelecimento"]]);
          etapas.set(id, { entrega_id: id, codigo: (r[c["Código"]] || "").trim() || null, cidade: cidadeComunique(r[c["UF - Cidade"]]),
            loja: (r[c["Estabelecimento"]] || "").trim() || null, loja_id: (r[c["estabelecimentoId"]] || "").trim() || null,
            pedido_em: g("createdAt (pedido)"), chamado_em: g("Solicitado At"), aceite_em: aceites[0] || null,
            chegou_em: g("Chegou Loja At"), saiu_em: g("Saiu Loja At"), entregue_em: g("Entregue At"), finalizado_em: g("Finalizado At"),
            bairro: c["Bairro da Entrega"] >= 0 ? (r[c["Bairro da Entrega"]] || "").trim() || null : null });
        }
        if (lojas.size === 1 && corpo.length > 50) avisos.push(`"${a.nome}" tem uma loja só (${[...lojas][0]}). Se não foi de propósito, baixe de novo com Estabelecimento em (Tudo).`);
      } else if (t.tipo === "resumo") {
        const ci = ix("Entrega Id"), ce = ix("Entregador"), cb = ix("Bairro Entrega");
        for (const r of corpo) {
          const id = (r[ci] || "").trim(), e = (r[ce] || "").trim();
          if (id && e && id !== "Total") nomes.set(id, e);
          if (id && cb >= 0 && (r[cb] || "").trim()) bairrosR.set(id, r[cb].trim());   // 009z13: o bairro também vem no Resumo
        }
      } else {
        const cn = ix("Nome"), cc = t.h.findIndex((n) => /munic|cidade/i.test(n));
        for (const r of corpo) {
          const id = (r[0] || "").trim(), k = nomeChave(r[cn]);
          if (!/^[A-Za-z0-9]{6,40}$/.test(id) || !k) continue;
          const l = ids.get(k) || []; if (!l.some((x) => x.id === id)) l.push({ id, cidade: nomeChave(r[cc]) }); ids.set(k, l);
        }
      }
      const fonte = t.tipo === "etapas" ? etapas : t.tipo === "resumo" ? nomes : ids;
      const info = { nome: a.nome, tipo: t.tipo, n: fonte.size - antes[t.tipo] };
      if (t.tipo === "etapas") {
        const ds = [...etapas.values()].slice(antes.etapas).map((p) => p.chamado_em).filter(Boolean).sort();
        info.de = ds[0]; info.ate = ds[ds.length - 1];
      }
      porArquivo.push(info);
    }
    if (!lidos.etapas) avisos.push("Falta o arquivo do painel \"Entregas por Loja (com tempo)\": é ele que traz os tempos de cada pedido.");
    if (lidos.etapas && !lidos.resumo) avisos.push("Falta o \"Resumo filtro\": sem ele, os pedidos chegam sem o nome do entregador.");
    if (lidos.etapas && !lidos.entregadores) avisos.push("Falta o \"Tempo de entrega dos entregadores\": sem ele, o ID de cada entregador fica para quem for decidir.");
    const pedidos = [...etapas.values()].map((p) => {
      const nome = nomes.get(p.entrega_id);
      const cidadeP = nomeChave((p.cidade || "").replace(/\s+-\s+[A-Z]{2}$/, ""));
      const op = nome ? ids.get(nomeChave(nome)) || [] : [];
      const daCidade = op.filter((o) => o.cidade === cidadeP);
      const [sit, id] = !nome || !op.length ? ["sem_id", null] : op.length === 1 ? ["ok", op[0].id] : daCidade.length === 1 ? ["conferir", daCidade[0].id] : ["escolher", null];
      return { ...p, bairro: p.bairro || bairrosR.get(p.entrega_id) || null, distancia_m: dist.get(p.entrega_id) ?? null, entregador_nome: nome ? titulo(nome) : null, entregador_id: id, entregador_situacao: sit,
        entregador_opcoes: sit === "conferir" || sit === "escolher" ? op.map((o) => ({ id: o.id, cidade: titulo(o.cidade) })) : [] };
    });
    const datas = pedidos.map((p) => p.chamado_em).filter(Boolean).sort();
    const resumo = { pedidos: pedidos.length, de: datas[0] || null, ate: datas[datas.length - 1] || null,
      com_entregador: pedidos.filter((p) => p.entregador_nome).length, com_id: pedidos.filter((p) => p.entregador_id).length,
      cidades: [...new Set(pedidos.map((p) => p.cidade).filter(Boolean))].sort(), lidos };
    return { pedidos, avisos, resumo, porArquivo };
  }

  // 009z6d: cada escolha SOMA à lista (antes trocava, e quem escolhia em mais de uma vez perdia as etapas)
  P.arquivos = [];
  async function lerArquivos(files) {
    for (const f of files) {
      const a = { nome: f.name, texto: decodificar(await f.arrayBuffer()) };
      const i = P.arquivos.findIndex((x) => x.nome === a.nome);
      if (i >= 0) P.arquivos[i] = a; else P.arquivos.push(a);
    }
    releer();
  }
  function releer() { P.leitura = P.arquivos.length ? ler(P.arquivos) : null; renderImportar(); }

  async function enviar(btn) {
    const l = P.leitura; if (!l?.pedidos.length || P.enviando) return;
    P.enviando = true; btn.disabled = true;
    const prog = $("#ped-progresso");
    try {
      for (let i = 0; i < l.pedidos.length; i += 1000) {
        prog.textContent = `Enviando ${Math.min(i + 1000, l.pedidos.length).toLocaleString("pt-BR")} de ${l.pedidos.length.toLocaleString("pt-BR")}…`;
        await rpc("importar_pedidos", { p_itens: l.pedidos.slice(i, i + 1000) });
      }
      // calcula os sinais uma semana por vez (cada chamada fica bem abaixo do limite de tempo do Supabase)
      const r = { pedidos: 0, com_sinal: 0, atencao: 0 };
      // 009z10: semanas de dias inteiros de Brasília (o resumo das Análises é feito por dia)
      const fim = new Date(l.resumo.ate.slice(0, 10) + "T23:59:59-03:00").getTime();
      for (let ini = new Date(l.resumo.de.slice(0, 10) + "T00:00:00-03:00").getTime(); ini <= fim; ini += 7 * 86400000) {
        prog.textContent = `Calculando os sinais (${App.u.dia(new Date(ini).toISOString())})…`;
        const x = await rpc("fechar_importacao_pedidos", { p_de: new Date(ini).toISOString(), p_ate: new Date(Math.min(ini + 7 * 86400000 - 1000, fim)).toISOString() });
        for (const k in r) r[k] += x[k] || 0;
      }
      App.uso("pedidos:importar");
      P.leitura = null; P.arquivos = [];
      toast(`${r.pedidos.toLocaleString("pt-BR")} pedidos no período; ${plural(r.com_sinal, "pedido fora do limite", "pedidos fora do limite")} (${r.atencao} com atenção).`);
      await carregar();
      location.hash = "#monitoramento/pedidos";   // 009z6e: depois de enviar, volta para a lista
    } catch (e) { toast(msgErro(e)); }
    finally { P.enviando = false; btn.disabled = false; prog.textContent = ""; renderImportar(); }
  }

  function renderImportar() {
    if (!mod() || !$("#ped-importar-corpo")) return;
    const l = P.leitura;
    const input = el("input", { type: "file", multiple: true, accept: ".csv,.txt,text/csv,text/tab-separated-values", id: "ped-arquivos",
      onchange: (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) lerArquivos(fs); } });
    const r = l?.resumo;
    const TIPO = { etapas: "Etapas", resumo: "Resumo filtro", entregadores: "Tempo de entrega dos entregadores" };
    const descr = (x) => !x.tipo ? "não reconhecido"
      : x.tipo === "etapas" ? `${TIPO.etapas}: ${x.n.toLocaleString("pt-BR")} pedidos${x.de ? ` de ${App.u.dia(x.de)} a ${App.u.dia(x.ate)}` : ""}`
      : x.tipo === "resumo" ? `${TIPO.resumo}: ${x.n.toLocaleString("pt-BR")} entregas com o entregador`
      : `${TIPO.entregadores}: ${x.n.toLocaleString("pt-BR")} nomes com ID`;
    const lista = l?.porArquivo?.length ? el("div", { class: "ped-escolhidos" },
      el("p", { class: "meta", text: `Arquivos escolhidos (${l.porArquivo.length}). Escolher de novo soma à lista.` }),
      el("ul", {}, l.porArquivo.map((x) => el("li", { class: x.tipo ? "" : "nao" },
        el("span", { class: "ped-arq-nome", text: x.nome }), el("span", { class: "meta", text: descr(x) }),
        el("button", { class: "btn link", type: "button", "aria-label": "Tirar " + x.nome, disabled: P.enviando,
          onclick: () => { P.arquivos = P.arquivos.filter((a) => a.nome !== x.nome); releer(); } }, "Tirar")))),
      el("button", { class: "btn link", type: "button", disabled: P.enviando, onclick: () => { P.arquivos = []; releer(); } }, "Limpar a lista")) : null;
    $("#ped-importar-corpo").replaceChildren(...[
      el("ol", { class: "ped-passos" },
        el("li", { text: "\"Entregas por Loja (com tempo)\": Estabelecimento (Tudo), Status FINALIZADO, o período que quiser (uma semana por arquivo, se ficar pesado)." }),
        el("li", { text: "\"Resumo filtro\": o mesmo período, Estabelecimento e Entregador em (Tudo)." }),
        el("li", { text: "\"Tempo de entrega dos entregadores\": os meses do período marcados, município em (Tudo)." })),
      el("p", { class: "meta", text: "Em cada painel: Download, Tabela de referência cruzada, CSV. Pode escolher todos os arquivos de uma vez; reenviar um período não repete pedidos." }),
      el("label", {}, "Arquivos baixados do Tableau", input),
      lista,
      ...(l ? [
        ...l.avisos.map((a) => el("p", { class: "warn-msg", text: a })),
        r.pedidos ? el("p", { class: "ped-resumo-leitura" },
          el("b", { text: `${r.pedidos.toLocaleString("pt-BR")} pedidos` }),
          ` de ${App.u.dia(r.de)} a ${App.u.dia(r.ate)} (${r.cidades.join(", ") || "sem cidade"}); `,
          `${Math.round((100 * r.com_entregador) / r.pedidos)}% com o entregador e ${Math.round((100 * r.com_id) / r.pedidos)}% com o ID.`) : null,
        r.pedidos ? el("div", { class: "actions" },
          el("button", { class: "btn primary", type: "button", disabled: P.enviando, onclick: (e) => enviar(e.currentTarget) }, `Enviar ${r.pedidos.toLocaleString("pt-BR")} pedidos`),
          el("span", { class: "meta", id: "ped-progresso", role: "status" })) : null] : [])].filter(Boolean));
  }

  // ---------- lista ----------
  async function carregar() {
    const f = P.filtros;
    P.dados = await rpc("listar_pedidos", { p_de: f.de || null, p_ate: f.ate || null, p_cidade: f.cidade || null, p_loja: f.loja || null,
      p_busca: f.busca.trim() || null, p_tipo: f.tipo || null, p_situacao: f.situacao || null, p_limite: P.limite, p_offset: 0 });
  }
  async function recarregar() {
    try { await carregar(); } catch (e) { toast(msgErro(e)); }
    render();
  }

  const min = (v) => (v == null ? "—" : `${Math.round(Number(v))} min`);
  const km = (m) => (m == null ? null : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
  const naoDoEntregador = (p) => p.sinal_total && !p.sinal_chegada && p.causa !== "entregador";
  // o rótulo do alto do cartão: o limite que passou
  function rotulo(p) {
    if (p.sinal_chegada) return ["Chegada na loja: " + min(p.t_chegada), "forte"];
    if (p.sinal_total) return ["Pedido em " + min(p.t_total), p.causa === "entregador" ? "forte" : "loja"];
    return ["Finalizou " + min(p.t_finalizar) + " depois", ""];
  }
  // a frase que explica o caso (a primeira parte em negrito)
  function frase(p) {
    const r = P.dados?.regras || {};
    if (p.sinal_chegada) return [`Levou ${min(p.t_chegada)} para chegar na loja depois de aceitar.`, ` O limite é ${Number(r.chegada_min)} min.`];
    if (p.sinal_total && p.causa === "entregador") {
      const rota = p.saiu_em && p.entregue_em ? (new Date(p.entregue_em) - new Date(p.saiu_em)) / 60000 : null;
      return [`O pedido levou ${min(p.t_total)} do chamado até a entrega.`, rota != null
        ? ` A maior parte foi no caminho até o cliente (${min(rota)}${p.distancia_m != null ? ` para ${km(p.distancia_m)}` : ""}).`
        : ` Do aceite à entrega foram ${min(p.t_entrega)}.`];
    }
    if (p.sinal_total && p.causa === "rota") return [`Passou de ${Number(r.total_min)} min, mas saiu da loja junto com outros ${p.rota_n - 1} ${p.rota_n - 1 === 1 ? "pedido" : "pedidos"}.`, " A demora veio da rota."];
    if (p.sinal_total && p.causa === "aceite") return [`Passou de ${Number(r.total_min)} min, mas o pedido esperou ${min(p.t_aceitar)} até alguém aceitar.`, " A demora não foi do entregador."];
    if (p.sinal_total && p.causa === "loja") return [`A demora foi na loja: ele esperou ${min(p.t_espera)} pelo pedido.`, " Do aceite à loja e da loja ao cliente, ficou dentro do normal."];
    if (p.sinal_total) return [`O pedido levou ${min(p.t_total)} do chamado até a entrega.`, " Foram várias demoras pequenas."];
    return [`Entregou, mas só finalizou ${min(p.t_finalizar)} depois.`, " Vale orientar o entregador."];
  }
  // a barra das etapas: cada pedaço do tamanho do tempo; vermelho = passou do limite, âmbar = espera na loja
  function barra(p) {
    const m = (x, y) => (x && y ? (new Date(y) - new Date(x)) / 60000 : null);
    const passos = [
      ["Aceite", m(p.chamado_em, p.aceite_em), p.causa === "aceite" ? "estourou" : "ok"],
      ...(p.chegou_em ? [["Até a loja", m(p.aceite_em, p.chegou_em), p.sinal_chegada ? "estourou" : "ok"], ["Na loja", m(p.chegou_em, p.saiu_em), "loja"]]
                      : [["Até sair da loja", m(p.aceite_em, p.saiu_em), "ok"]]),
      ["Até o cliente", m(p.saiu_em, p.entregue_em), p.sinal_total && p.causa === "entregador" && !p.sinal_chegada ? "estourou" : "ok"],
      ["Finalizar", m(p.entregue_em, p.finalizado_em), p.sinal_finalizacao ? "estourou" : "ok"]].filter((x) => x[1] != null && x[1] >= 0);
    const soma = passos.reduce((a, x) => a + Number(x[1]), 0) || 1;
    const total = passos.reduce((a, x) => a + Number(x[1]), 0);
    return el("div", { class: "ped-barra-box" },
      el("div", { class: "ped-barra", role: "img", "aria-label": "Etapas: " + passos.map(([n, v]) => `${n} ${min(v)}`).join(", ") },
        ...passos.map(([n, v, c]) => el("span", { class: "seg " + c, style: `flex-grow:${Math.max(Number(v), soma * 0.03)}` }))),
      el("div", { class: "ped-barra-rotulos" },
        ...passos.map(([n, v, c]) => el("span", { class: c === "estourou" ? "estourou" : "" }, `${n} ${min(v)}`)),
        // 009z14b: passou do limite (chamado → entrega) = total em vermelho, com o texto (cor nunca sozinha)
        Number(p.t_total) > limiteTotal()
          ? el("b", { class: "ped-total estourou", text: `Total ${min(total)} · acima de ${limiteTotal()} min` })
          : el("b", { class: "ped-total", text: `Total ${min(total)}` })));
  }
  function sugestao(p) {
    const B = App.bloqueios, g = p.sugestao;
    if (p.decisao) return null;
    let txt;
    if (naoDoEntregador(p)) txt = "Não contar para o entregador" + (p.causa === "rota" ? " (rota com vários pedidos)" : p.causa === "aceite" ? " (demorou para alguém aceitar)" : p.causa === "loja" ? " (espera na loja)" : "");
    else if (!p.sinal_chegada && !p.sinal_total) txt = "Orientar o entregador (finalização tardia)";
    else if (g) txt = `Atraso · ${B.ord(g.ocorrencia)} ocorrência${g.janela_dias ? ` em ${g.janela_dias} dias` : ""} · ${g.encerramento ? "encerramento de parceria" : "restrição de " + B.horasTxt(g.horas)}`;
    else txt = "Atraso (confira o ID para ver a punição)";
    return el("p", { class: "ped-sugestao" }, el("span", { class: "rot", text: "Sugestão" }), el("b", { text: txt }));
  }
  function copiarBtn(valor, rot, aviso) {
    return el("button", { class: "btn small ped-copiar", type: "button", onclick: async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(valor); toast(aviso); } catch (_) { toast("Não deu para copiar: " + valor); } } }, rot);
  }
  function entregador(p) {
    const aviso = { conferir: "Nome igual ao de outro entregador: confira o ID.", escolher: "Nome igual ao de outro entregador: escolha o ID.",
      sem_id: p.entregador_nome ? "Sem ID: preencha ao confirmar." : "Entregador não encontrado no Resumo: preencha o ID ao confirmar." }[p.entregador_situacao];
    // 009z9: com nomes iguais, o aviso abre os entregadores com esse nome para escolher o certo
    const clicavel = !p.decisao && (p.entregador_situacao === "conferir" || p.entregador_situacao === "escolher");
    return [el("div", { class: "ped-nome" }, el("h3", { text: p.entregador_nome || "Entregador sem nome" }),
        p.entregador_id ? copiarBtn(p.entregador_id, "Copiar ID", "ID copiado.") : null,
        p.entregador_id ? el("span", { class: "so-leitor", text: p.entregador_id }) : null),
      !aviso ? null : clicavel
        ? el("button", { class: "ped-aviso-id link", type: "button", onclick: () => abrirEscolha(p) }, aviso, " Ver os entregadores com este nome")
        : el("p", { class: "ped-aviso-id", text: aviso })];
  }
  async function abrirEscolha(p) {
    const corpo = el("div", { class: "ped-escolha" }, carregandoEl());
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const todos = el("input", { type: "checkbox" });
    const caixaTodos = el("label", { class: "check", hidden: true }, todos, el("span", {}));
    const d = janela("Qual é o entregador deste pedido?",
      el("p", { class: "meta", style: "margin:0", text: [p.codigo ? `Pedido ${p.codigo}` : null, p.loja, p.cidade, p.chamado_em ? dt(p.chamado_em) : null].filter(Boolean).join(" · ") }),
      corpo, caixaTodos, erro,
      el("div", { class: "actions" }, el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    let o;
    try { o = await rpc("opcoes_entregador_pedido", { p_entrega_id: p.entrega_id }); }
    catch (e) { corpo.replaceChildren(el("p", { class: "warn-msg", text: msgErro(e) })); return; }
    if (o.pedidos_mesmo_nome > 1) {
      todos.checked = true; caixaTodos.hidden = false;
      caixaTodos.lastChild.textContent = ` Aplicar também aos outros ${o.pedidos_mesmo_nome - 1} pedidos de ${o.nome} ainda não decididos`;
    }
    const escolher = async (id, btn) => {
      erro.hidden = true; btn.disabled = true;
      try {
        const r = await rpc("escolher_entregador_pedido", { p_entrega_id: p.entrega_id, p_id_app: id, p_todos: todos.checked && !caixaTodos.hidden });
        App.uso("pedidos:escolher_id");
        d.close(); toast(r.pedidos > 1 ? `ID ${id} gravado em ${r.pedidos} pedidos.` : `ID ${id} gravado no pedido.`);
        await recarregar();
      } catch (e) { btn.disabled = false; erro.textContent = msgErro(e); erro.hidden = false; }
    };
    corpo.replaceChildren(
      el("p", { text: `Há ${o.opcoes.length} entregadores chamados ${o.nome}. Confira pela ficha, pela cidade e pelas restrições e escolha o deste pedido.` }),
      el("ul", { class: "ped-opcoes-lista" }, o.opcoes.map((x) => el("li", { class: x.atual ? "atual" : "" },
        el("div", { class: "ped-op-topo" }, el("b", { class: "mono", text: x.id }), copiarBtn(x.id, "Copiar ID", "ID copiado."),
          x.atual ? el("span", { class: "tag", text: "no pedido agora" }) : null),
        el("p", { class: "meta", text: [
          x.ficha_nome ? `Ficha: ${x.ficha_nome}${x.ficha_cidade ? " · " + x.ficha_cidade : ""}` : "Sem ficha no Comunique",
          x.cidade_tableau ? `Cidade no Quero Log: ${x.cidade_tableau}` : null].filter(Boolean).join(" · ") }),
        el("p", { class: "meta", text: [App.u.plural(x.restricoes, "restrição", "restrições") + (x.ultima_restricao ? ` (última em ${App.u.dia(x.ultima_restricao)})` : ""),
          App.u.plural(x.cadastros, "cadastro na ativação", "cadastros na ativação"), App.u.plural(x.pedidos, "pedido aqui", "pedidos aqui")].join(" · ") }),
        el("div", { class: "actions" },
          el("button", { class: "btn" + (x.atual ? "" : " primary"), type: "button", onclick: (e) => escolher(x.id, e.currentTarget) }, x.atual ? "Manter este" : "É este"),
          x.ficha_nome ? el("button", { class: "btn link", type: "button", onclick: () => App.abrirFicha?.(x.id) }, "Ver a ficha") : null)))));
  }
  function acoes(p) {
    const ficha = p.entregador_id ? el("button", { class: "btn link ped-ficha", type: "button", onclick: () => App.abrirFicha?.(p.entregador_id) }, "Ficha do entregador") : null;
    if (!p.decisao) return [el("div", { class: "actions" },
      el("button", { class: "btn" + (naoDoEntregador(p) || (!p.sinal_chegada && !p.sinal_total) ? "" : " primary"), type: "button", onclick: () => abrirConfirmar(p) }, "Confirmar restrição"),
      el("button", { class: "btn", type: "button", onclick: () => abrirDescartar(p) }, "Descartar"),
      p.codigo ? el("span", { class: "ped-dir" }, copiarBtn(p.codigo, "Copiar código", "Código do pedido copiado.")) : null), ficha];
    const quem = `${p.decidido_por_nome || "alguém"} em ${dt(p.decidido_em)}`;
    return [el("div", { class: "actions ped-decidido" },
      el("span", { text: p.decisao === "restricao" ? `Virou restrição · ${quem}` : `Descartado (${p.motivo || "sem motivo"}) · ${quem}` }),
      p.pode_reabrir ? el("button", { class: "btn link", type: "button", onclick: (e) => reabrir(p, e.currentTarget) }, "Reabrir") : null), ficha];
  }
  // 009z6c (pedido do usuário): etapas marcadas fora do lugar, como no desenho (caixa âmbar)
  function foraDoLugar(p) {
    const seg = (x, y) => (x && y ? Math.round((new Date(y) - new Date(x)) / 1000) : null);
    const s = seg(p.saiu_em, p.entregue_em);
    if (s == null || s < 0 || s >= 60) return null;
    return el("p", { class: "ped-alerta", role: "note" },
      `Marcou “entregue” ${s === 1 ? "1 segundo" : s + " segundos"} depois de sair da loja${p.distancia_m != null ? `, para uma entrega de ${km(p.distancia_m)}` : ""}. Vale conferir se as etapas foram marcadas na hora certa (pode ser finalização falsa).`);
  }
  // 009z13 (pedido do usuário): "Ver a rota" = os pedidos que saíram junto, na ordem da entrega
  P.rotasAbertas = P.rotasAbertas || new Set();
  const horaTxt = (t) => (t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: App.u.FUSO }) : "—");
  function rota(p) {
    const lista = Array.isArray(p.rota_pedidos) ? p.rota_pedidos : [];
    if (lista.length < 2) return null;
    const outros = lista.length - 1, pos = lista.findIndex((x) => x.entrega_id === p.entrega_id) + 1;
    const lojas = new Set(lista.map((x) => x.loja).filter(Boolean));
    const saiu = lista.map((x) => x.saiu_em).filter(Boolean).sort()[0];
    const d = el("details", { class: "ped-rota" },
      el("summary", { text: `Ver a rota (${outros} ${outros === 1 ? "outro pedido" : "outros pedidos"})` }),
      el("p", { class: "meta", text: `Saíram ${lojas.size > 1 ? "das lojas" : "da loja"} às ${horaTxt(saiu)}, com ${p.entregador_nome || "o mesmo entregador"}.` }),
      el("ol", { class: "ped-rota-lista" }, lista.map((x, i) => {
        const este = x.entrega_id === p.entrega_id;
        return el("li", { class: este ? "este" : "" },
          el("span", { class: "ped-rota-ordem", text: `${i + 1}º` }),
          el("span", { class: "ped-rota-txt" },
            el("b", { text: este ? "Este pedido" : x.codigo ? `Pedido ${x.codigo}` : "Pedido sem código" }),
            [lojas.size > 1 ? x.loja : null, x.bairro, `entregue às ${horaTxt(x.entregue_em)}`, x.t_total != null ? `total ${Math.round(Number(x.t_total))} min` : null]
              .filter(Boolean).map((t) => " · " + t).join(""),
            x.sinal && !este ? el("span", { class: "pill bloqueado ped-rota-sinal", text: "passou do limite" }) : null),
          !este && x.codigo ? copiarBtn(x.codigo, "Copiar", `Código ${x.codigo} copiado.`) : null);
      })),
      pos ? el("p", { class: "ped-rota-fim", text: `Este foi o ${pos}º de ${lista.length} entregas da rota.` }) : null);
    if (P.rotasAbertas.has(p.entrega_id)) d.open = true;
    d.addEventListener("toggle", () => (d.open ? P.rotasAbertas.add(p.entrega_id) : P.rotasAbertas.delete(p.entrega_id)));
    return d;
  }
  function card(p) {
    const [rot, cls] = rotulo(p), [f1, f2] = frase(p);
    return el("article", { class: "card linha-ped" + (p.atencao && !p.decisao ? " atencao" : "") },
      el("div", { class: "head" },
        el("span", { class: "pill ped-sinal " + cls, text: rot }),
        el("span", { class: "meta ped-pedido", text: [p.codigo ? `Pedido #${p.codigo}` : "Pedido sem código", p.chamado_em ? dt(p.chamado_em) : null].filter(Boolean).join(" · ") })),
      ...entregador(p),
      el("p", { class: "meta", text: [p.cidade, p.bairro, p.loja].filter(Boolean).join(" · ") }),
      el("p", { class: "ped-frase" }, el("b", { text: f1 }), f2),
      barra(p),
      rota(p),
      foraDoLugar(p),
      sugestao(p),
      ...acoes(p));
  }

  // 009z14: o limite do total vem do banco (parametros_pedidos.total_min; 35 desde a 009z14)
  const limiteTotal = () => Number(P.dados?.regras?.total_min || 35);
  // os quatro números do topo, como no desenho
  function numeros() {
    const n = P.dados?.numeros, box = $("#ped-numeros");
    if (!n) return box.replaceChildren();
    const de = (v) => (n.pedidos ? `de ${n.pedidos.toLocaleString("pt-BR")} pedidos (${((100 * v) / n.pedidos).toFixed(1).replace(".", ",")}%)` : "");
    const q = (k, v, sub) => el("div", { class: "tile ped-numero" }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v.toLocaleString("pt-BR") }), el("div", { class: "meta", text: sub }));
    box.replaceChildren(q("Chegada na loja acima de 15 min", n.chegada, de(n.chegada)), q(`Pedidos acima de ${limiteTotal()} min`, n.total, de(n.total)),
      q("A demora não foi do entregador", n.loja, "rota, espera na loja ou ninguém aceitou"),
      el("div", { class: "tile ped-numero" }, el("div", { class: "k", text: "Decisões" }),
        el("div", { class: "v" }, String(n.confirmados), el("small", { text: n.confirmados === 1 ? " confirmada" : " confirmadas" })),
        el("div", { class: "meta", text: `${n.descartados} ${n.descartados === 1 ? "descartada" : "descartadas"} · ${n.esperando} esperando` })));
  }

  function pilhas() {
    const d = P.dados, f = P.filtros;
    const botao = (grupo, k, rot, v, cls = "") => el("button", { type: "button", class: "tile clicavel " + cls + (f[grupo] === k ? " ativo" : ""),
      "aria-pressed": String(f[grupo] === k), onclick: () => { f[grupo] = f[grupo] === k && k ? "" : k; P.limite = 50; recarregar(); } },
      el("div", { class: "k", text: rot }), el("div", { class: "v", text: v ?? "…" }));
    const t = d?.tipos || {}, s = d?.situacoes || {};
    $("#ped-tipos").replaceChildren(botao("tipo", "atrasos", "Todos", t.atrasos), botao("tipo", "chegada", "Chegada na loja > 15 min", t.chegada),
      botao("tipo", "total", `Acima de ${limiteTotal()} min`, t.total), botao("tipo", "loja", "A demora não foi do entregador", t.loja),
      botao("tipo", "finalizacao", "Finalização tardia", t.finalizacao));
    $("#ped-situacoes").replaceChildren(botao("situacao", "a_decidir", "A decidir", s.a_decidir, s.a_decidir ? "hl" : ""),
      botao("situacao", "restricao", "Viraram restrição", s.restricao), botao("situacao", "descartado", "Descartados", s.descartado),
      botao("situacao", "", "Todas as situações", s.todos));
  }

  function opcoes(sel, lista, primeiro) {
    const atual = sel.value;
    sel.replaceChildren(el("option", { value: "", text: primeiro }), ...lista.map((v) => el("option", { value: v, text: v })));
    sel.value = lista.includes(atual) ? atual : "";
  }

  function render() {
    const d = P.dados, box = $("#ped-lista");
    if (!d) return box.replaceChildren(carregandoEl());
    opcoes($("#ped-cidade"), d.cidades, "Todas as cidades");
    opcoes($("#ped-loja"), d.lojas, "Todas as lojas");
    // 009z10: vindo de uma loja das Análises, o filtro aparece escolhido e aberto
    if (P.filtros.loja) { $("#ped-loja").value = P.filtros.loja; const mf = $(".ped-mais-filtros"); if (mf) mf.open = true; }
    pilhas(); numeros();
    $("#ped-atualizado").textContent = d.periodo?.de
      ? `Dados de ${App.u.dia(d.periodo.de)} a ${App.u.dia(d.periodo.ate)}${d.importado_em ? ` · enviados em ${dt(d.importado_em)}` : ""}` : "";
    if (!d.periodo?.de) return box.replaceChildren(vazio("Nenhum pedido ainda", mod() ? "Envie os arquivos do Tableau na aba Enviar dados, aqui no Monitoramento." : "Quando um moderador enviar os dados do Tableau, os pedidos fora do limite aparecem aqui."));
    if (!d.itens.length) return box.replaceChildren(vazio("Nada com esses filtros", ""));
    box.replaceChildren(...[el("div", { class: "ped-grade" }, d.itens.map(card)),
      d.total > d.itens.length ? el("div", { class: "actions" }, el("button", { class: "btn", type: "button", onclick: () => { P.limite += 50; recarregar(); } },
        `Mostrar mais (${(d.total - d.itens.length).toLocaleString("pt-BR")} restantes)`)) : null].filter(Boolean));
  }

  // ---------- decidir ----------
  function comentarioPadrao(p) {
    const partes = [p.sinal_chegada ? `chegou na loja ${min(p.t_chegada)} depois de aceitar` : null,
      p.sinal_total ? `${min(p.t_total)} do chamado até a entrega` : null,
      p.sinal_finalizacao ? `finalizou ${min(p.t_finalizar)} depois de entregar` : null].filter(Boolean);
    return `Pedido ${p.codigo || p.entrega_id} (${p.loja || "loja"}, ${p.chamado_em ? dt(p.chamado_em) : ""}): ${partes.join("; ")}.`;
  }
  function abrirConfirmar(p) {
    const opc = p.entregador_opcoes || [];
    const id = el("input", { class: "mono", maxlength: "40", autocomplete: "off", spellcheck: "false", "aria-label": "ID do entregador",
      oninput: (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, ""); preparar(); } });
    id.value = p.entregador_id || "";
    const escolha = opc.length ? el("div", { class: "opcoes ped-opcoes", role: "group", "aria-label": "Entregadores com este nome" },
      ...opc.map((o) => el("button", { type: "button", class: "btn small", onclick: () => { id.value = o.id; preparar(); } }, `${o.id} · ${o.cidade || "sem cidade"}`))) : null;
    const nome = el("input", { maxlength: "120", autocomplete: "off" }); nome.value = p.entregador_nome || "";
    const cidades = (App.bloqueios?.B?.regras?.cidades || []).filter((c) => c.ativa).map((c) => c.nome);
    const cid = el("select", {}, el("option", { value: "", text: "Escolha a cidade" }), ...cidades.map((c) => el("option", { value: c, text: c })));
    cid.value = cidades.includes(p.cidade) ? p.cidade : "";
    const com = el("textarea", { maxlength: "1500", rows: "3" }); com.value = comentarioPadrao(p);
    const previa = el("div", { class: "ped-previa", role: "status" });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    let juntar = null, timer = null;
    function preparar() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (id.value.length < 4) { previa.replaceChildren(el("p", { class: "meta", text: "Preencha o ID para ver a punição prevista." })); juntar = null; return; }
        try {
          const r = await rpc("preparar_restricao_pedido", { p_entrega_id: p.entrega_id, p_id_app: id.value });
          const pv = r.previa || {}, Bq = App.bloqueios;
          juntar = r.juntar;
          if (pv.nome_conhecido && !nome.value.trim()) nome.value = pv.nome_conhecido;
          if (pv.cidade_conhecida && !cid.value && cidades.includes(pv.cidade_conhecida)) cid.value = pv.cidade_conhecida;
          const radios = juntar ? [
            el("label", {}, el("input", { type: "radio", name: "ped-juntar", value: "sim", checked: true }),
              ` Juntar este pedido à restrição por atraso registrada ${dt(juntar.inicio)} por ${juntar.registrado_por_nome} (${plural(juntar.pedidos, "pedido", "pedidos")} nela)`),
            el("label", {}, el("input", { type: "radio", name: "ped-juntar", value: "nao" }), " Registrar outra restrição")] : [];
          previa.replaceChildren(...[
            el("p", {}, el("b", { text: r.infracao.nome }), pv.ocorrencia ? ` · seria a ${Bq.ord(pv.ocorrencia)} ocorrência: ${Bq.horasTxt(pv.horas)}${pv.fim ? `, até ${Bq.termino(pv.fim)}` : ""}.` : "."),
            pv.nome_conhecido && nome.value.trim() && nomeChave(pv.nome_conhecido) !== nomeChave(nome.value) ? el("p", { class: "warn-msg", text: `Na ficha do Comunique este ID é de ${pv.nome_conhecido}. Confira.` }) : null,
            ...radios].filter(Boolean));
        } catch (e) { previa.replaceChildren(el("p", { class: "warn-msg", text: msgErro(e) })); }
      }, 300);
    }
    async function registrar(btn) {
      erro.hidden = true;
      const junta = !!juntar && d.querySelector('input[name="ped-juntar"]:checked')?.value === "sim";
      if (id.value.length < 4) { erro.textContent = "Preencha o ID do entregador."; erro.hidden = false; id.focus(); return; }
      if (!junta && !nome.value.trim()) { erro.textContent = "Preencha o nome do entregador."; erro.hidden = false; nome.focus(); return; }
      if (!junta && !cid.value) { erro.textContent = "Escolha a cidade."; erro.hidden = false; cid.focus(); return; }
      btn.disabled = true;
      try {
        const r = await rpc("pedido_virar_restricao", { p_entrega_id: p.entrega_id, p_id_app: id.value, p_nome: nome.value.trim(), p_cidade: cid.value,
          p_comentario: com.value.trim() || null, p_juntar: junta });
        App.uso(junta ? "pedidos:juntar" : "pedidos:restricao");
        d.close();
        toast(r.juntado ? "Pedido juntado à restrição de hoje." : `Restrição registrada: ${App.bloqueios.ord(r.ocorrencia)} ocorrência, ${App.bloqueios.horasTxt(r.horas)}.`);
        await recarregar();
      } catch (e) { btn.disabled = false; erro.textContent = msgErro(e); erro.hidden = false; }
    }
    const d = janela("Confirmar restrição",
      el("p", { class: "meta", style: "margin:0", text: [p.codigo ? `Pedido ${p.codigo}` : null, p.loja, p.cidade, p.chamado_em ? dt(p.chamado_em) : null].filter(Boolean).join(" · ") }),
      el("div", { class: "ped-sinais" }, el("span", { class: "pill ped-sinal " + rotulo(p)[1], text: rotulo(p)[0] })),
      el("div", { class: "grid2" }, el("label", {}, "ID do entregador", id), el("label", {}, "Nome do entregador", nome)),
      p.entregador_situacao === "conferir" || p.entregador_situacao === "escolher"
        ? el("p", { class: "warn-msg", text: p.entregador_situacao === "conferir" ? "Há outro entregador com este nome. O ID veio pela cidade: confira." : "Há mais de um entregador com este nome na cidade. Escolha o ID:" }) : null,
      escolha,
      !p.sinal_chegada && !p.sinal_total ? el("p", { class: "meta", text: "A finalização tardia ainda não tem infração própria: se confirmar, a restrição será por atraso." }) : null,
      el("label", {}, "Cidade", cid),
      el("label", {}, "Comentário (fica na ficha do entregador)", com),
      previa, erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => registrar(e.currentTarget) }, "Registrar restrição"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
    preparar();
  }

  const MOTIVOS = [["loja", "Demora da loja"], ["rota", "Rota com vários pedidos"], ["aceite", "Demorou para alguém aceitar"],
    ["app", "Problema no app"], ["cliente", "Problema com o cliente"], ["outro", "Outro"]];
  function abrirDescartar(p) {
    const sel = el("select", {}, el("option", { value: "", text: "Escolha o motivo" }), ...MOTIVOS.map(([v, t]) => el("option", { value: v, text: t })));
    sel.value = { loja: "loja", rota: "rota", aceite: "aceite" }[p.causa] || "";
    const txt = el("textarea", { maxlength: "400", rows: "2", placeholder: "Detalhe (obrigatório em Outro)" });
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    async function salvar(btn) {
      erro.hidden = true; btn.disabled = true;
      try {
        await rpc("descartar_pedido", { p_entrega_id: p.entrega_id, p_motivo: sel.value, p_texto: txt.value.trim() || null });
        App.uso("pedidos:descartar:" + sel.value);
        d.close(); toast("Pedido descartado: não vira restrição.");
        await recarregar();
      } catch (e) { btn.disabled = false; erro.textContent = msgErro(e); erro.hidden = false; }
    }
    const d = janela("Descartar: não vira restrição",
      el("p", { class: "meta", style: "margin:0", text: [p.codigo ? `Pedido ${p.codigo}` : null, p.entregador_nome, p.loja].filter(Boolean).join(" · ") }),
      el("label", {}, "Motivo", sel), el("label", {}, "Detalhe", txt), erro,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => salvar(e.currentTarget) }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  async function reabrir(p, btn) {
    btn.disabled = true;
    try {
      const r = await rpc("reabrir_pedido", { p_entrega_id: p.entrega_id });
      toast(r.tinha_restricao ? "Pedido reaberto. A restrição registrada continua: libere em Com restrição agora, se for o caso." : "Pedido reaberto.");
      await recarregar();
    } catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }

  // filtros: o período e a busca esperam a pessoa parar de digitar
  let espera = null;
  const mudou = (k, v, ja) => { P.filtros[k] = v; P.limite = 50; clearTimeout(espera); espera = setTimeout(recarregar, ja ? 0 : 400); };
  $("#ped-de").addEventListener("change", (e) => mudou("de", e.target.value, true));
  $("#ped-ate").addEventListener("change", (e) => mudou("ate", e.target.value, true));
  $("#ped-cidade").addEventListener("change", (e) => mudou("cidade", e.target.value, true));
  $("#ped-loja").addEventListener("change", (e) => mudou("loja", e.target.value, true));
  $("#ped-busca").addEventListener("input", (e) => mudou("busca", e.target.value));

  App.pedidos = { carregar, render, ler, linhas, decodificar, P };
  // 009z6b (pedido do usuário): item próprio no menu, "Monitoramento"; mesmo acesso das Restrições
  App.modulo({
    id: "monitoramento", nome: "Monitoramento",
    acesso: () => !!papel(),
    abas: [{ id: "pedidos", nome: "Pedidos fora do limite", secao: "v-bq-pedidos" },
           { id: "sem-chamar", nome: "Sem chamar", secao: "v-pa-sem" },   // 009z13b: veio de Parceiros
           { id: "enviar", nome: "Enviar dados", secao: "v-mon-enviar", pode: mod }],   // 009z6e: o envio saiu de cima da lista
    padrao: () => "pedidos",
    async carregar(aba) {
      if (aba === "enviar") return;
      if (aba === "sem-chamar") return App.semChamar?.carregar();
      const B = App.bloqueios?.B;   // as cidades da janela de confirmar vêm das regras das Restrições
      await Promise.all([carregar(), B && !B.regras ? rpc("regras_bloqueio").then((d) => { B.regras = d; B.regrasEm = Date.now(); }) : null]);
    },
    render(aba) { if (aba === "enviar") renderImportar(); else if (aba === "sem-chamar") App.semChamar?.render(); else render(); },
  });
})();
