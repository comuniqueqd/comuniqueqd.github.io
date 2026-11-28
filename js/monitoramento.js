// 009z18 "Monitoramento novo" (desenho "Monitoramento: proposta das 4 abas", aprovado pelo usuário em 28/11/2026).
// Abas: Entregadores (ranking no SLA: quem mais pesa / quem mais ajuda), Parceiros (js/parceiros.js, App.semChamar),
// Pedidos atrasados (oculta: abre pelo entregador; js/pedidos.js) e Enviar dados (moderador). Tudo vem dos resumos que o
// banco monta a cada envio do Tableau (supabase/009z18-monitoramento-novo.sql).
(() => {
  const App = window.App;
  const { $, el, vazio, carregandoEl, rpc, msgErro, toast } = App.u;
  const S = App.S;
  const papel = () => S.me?.papel_bloqueios;
  const mod = () => papel() === "moderador";
  const plural = (n, um, varios) => App.u.plural(n, um, varios);
  const E = { dados: null, filtros: { busca: "", cidade: "", dias: 30, min: 30, modo: "pesa" }, limite: 10, aberto: null, detalhe: {} };
  const n1 = (v, casas = 1) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  async function carregar() {
    const f = E.filtros;
    E.dados = await rpc("monitor_entregadores", { p_dias: f.dias, p_cidade: f.cidade || null, p_busca: f.busca.trim() || null,
      p_min: f.min, p_modo: f.modo, p_limite: E.limite });
  }
  async function recarregar() { try { await carregar(); } catch (e) { toast(msgErro(e)); } render(); }

  function numeros(d) {
    const ajuda = E.filtros.modo === "ajuda", l = d.lista || [];
    const ganho = l.reduce((s, x) => s + Number(E.filtros.cidade ? x.impacto_cidade : x.impacto_geral), 0);
    const cid = E.filtros.cidade ? E.filtros.cidade.replace(/ - [A-Z]{2}$/, "") : null;
    const card = (rot, valor, sub, destaque) => el("div", { class: "mon-num" + (destaque ? " destaque" : "") },
      el("span", { class: "mon-num-rot", text: rot }), el("span", { class: "mon-num-val", text: valor }), el("span", { class: "meta", text: sub }));
    $("#me-numeros").replaceChildren(
      card(cid ? `SLA de ${cid}` : "SLA de todas as cidades", `${n1(d.sla)}%`, `entregas em até ${d.limite} min`),
      card(ajuda ? `Se ${l.length === 1 ? "este atrasasse" : `estes ${l.length} atrasassem`} como a média` : `Sem os atrasos ${l.length === 1 ? "deste" : `destes ${l.length}`}`,
        `${n1(ajuda ? d.sla - ganho : d.sla + ganho)}%`, `${ajuda ? "o SLA cairia" : "o SLA subiria"} ${n1(ganho)} ${Math.abs(ganho) === 1 ? "ponto" : "pontos"}`, true),
      card("Entregas no período", Number(d.pedidos).toLocaleString("pt-BR"), cid ? `só ${cid}` : plural(d.n_cidades, "cidade", "cidades")),
      card("Atrasos com causa no entregador", Number(d.at_entregador).toLocaleString("pt-BR"),
        d.atraso ? `${Math.round((d.at_entregador * 100) / d.atraso)}% de todos os atrasos` : "nenhum atraso"));
  }

  function detalhe(x) {
    const det = E.detalhe[x.chave];
    if (!det) return el("td", { colspan: "8", class: "mon-det" }, carregandoEl());
    const linha = (rot, v) => el("div", { class: "mon-det-linha" }, el("span", { text: rot }), el("b", { text: v }));
    const pct = (a, p) => (p ? (a * 100) / p : null);
    const agora = pct(det.atraso, det.pedidos), antes = det.antes?.pedidos ? pct(det.antes.atraso, det.antes.pedidos) : null;
    const tend = antes == null ? "Sem dados do período anterior" : Math.abs(agora - antes) < 0.5 ? `Igual ao período anterior (${n1(antes)}% de atraso)`
      : agora > antes ? `Piorou: ${n1(antes)}% de atraso no período anterior` : `Melhorou: ${n1(antes)}% de atraso no período anterior`;
    const dias = (det.dias || []).map((y) => DIAS[y.dow]).join(" e ");
    const horas = (det.horas || []).map((y) => y.hora).sort((a, b) => a - b);
    const quando = dias || horas.length ? [dias, horas.length ? `por volta das ${horas.map((h) => h + "h").join(", ")}` : ""].filter(Boolean).join(", ") : "Sem atrasos do entregador guardados (45 dias)";
    return el("td", { colspan: "8", class: "mon-det" }, el("div", { class: "mon-det-grade" },
      el("div", {}, el("span", { class: "mon-det-rot", text: "De onde vêm os atrasos" }),
        linha(`Chegou na loja depois de ${E.dados.regras_chegada ?? 15} min`, det.chegada),
        linha(`Mais de ${E.dados.limite} min com o pedido em tela`, det.tela),
        linha("Finalizou mais de 10 min depois", det.finalizou)),
      el("div", {}, el("span", { class: "mon-det-rot", text: "Quando mais atrasa" }),
        el("p", { text: quando[0].toUpperCase() + quando.slice(1) }),
        det.bairros?.length ? el("p", { text: "Bairros: " + det.bairros.join(", ") }) : null,
        det.media_cidade_hora != null ? el("p", { class: "meta", text: `Média da cidade nesse horário: ${Math.round(det.media_cidade_hora)} min` }) : null),
      el("div", {}, el("span", { class: "mon-det-rot", text: "Histórico" }),
        el("p", { text: x.id ? plural(det.restricoes, "restrição nos últimos 60 dias", "restrições nos últimos 60 dias") : "Sem ID: confira o nome antes de registrar" }),
        el("p", { text: tend }),
        el("div", { class: "actions" },
          el("button", { class: "btn small primary", type: "button", onclick: () => App.pedidos.doEntregador(x) }, "Ver os pedidos atrasados"),
          x.id ? el("button", { class: "btn small", type: "button", onclick: () => App.abrirFicha?.(x.id) }, "Ficha do entregador") : null))));
  }
  async function abrir(x) {
    E.aberto = E.aberto === x.chave ? null : x.chave;
    render();
    if (E.aberto && !E.detalhe[x.chave]) {
      try { E.detalhe[x.chave] = await rpc("monitor_entregador", { p_chave: x.chave, p_dias: E.filtros.dias }); }
      catch (e) { toast(msgErro(e)); E.aberto = null; }
      render();
    }
  }

  function render() {
    const d = E.dados, box = $("#me-lista");
    if (!d) return box.replaceChildren(carregandoEl());
    const sel = $("#me-cidade"), atual = E.filtros.cidade;
    sel.replaceChildren(el("option", { value: "", text: "Todas as cidades" }), ...(d.cidades || []).map((c) => el("option", { value: c, text: c })));
    sel.value = (d.cidades || []).includes(atual) ? atual : "";
    sel.closest("label").hidden = (d.cidades || []).length <= 1 && !atual;
    if (d.vazio) {
      $("#me-numeros").replaceChildren(); $("#me-dados").textContent = "";
      return box.replaceChildren(vazio("Ainda não há pedidos do Tableau", mod() ? "Envie os arquivos na aba Enviar dados." : "Quando um moderador enviar os dados do Tableau, o ranking aparece aqui."));
    }
    const ajuda = E.filtros.modo === "ajuda", porCidade = !!E.filtros.cidade;
    $("#me-dados").textContent = `Dados do Tableau de ${App.u.dia(d.de)} a ${App.u.dia(d.ate)}`;
    numeros(d);
    document.querySelectorAll("[data-me-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.meModo === E.filtros.modo)));
    $("#me-lista-tit").textContent = ajuda ? "Quem mais ajuda no SLA" : "Quem mais pesa no SLA";
    $("#me-contagem").textContent = `${plural(d.entregadores, "entregador", "entregadores")} · ordenado pelo impacto no SLA ${porCidade ? "da cidade" : "de todas as cidades"}`;
    $("#me-explica").textContent = ajuda
      ? `Impacto = quantos pontos o SLA cairia se as entregas dessa pessoa atrasassem como a média da cidade. Quem entrega muito e quase nunca atrasa sobe na lista.`
      : `Impacto = quantos pontos o SLA subiria sem os atrasos com causa nessa pessoa (chegada na loja acima de 15 min ou mais de ${d.limite} min com o pedido em tela, saindo sozinho). Clique na linha para ver de onde vêm os atrasos.`;
    if (!d.lista.length) return box.replaceChildren(vazio("Ninguém com esses filtros", ajuda ? "" : "Nenhum entregador com atraso causado por ele no período."));
    const sinal = ajuda ? "+" : "−", cor = ajuda ? "ok" : "bad";
    const max = Math.max(...d.lista.map((x) => Number(porCidade ? x.impacto_cidade : x.impacto_geral)), 0.01);
    const linhas = [];
    d.lista.forEach((x, i) => {
      const imp = Number(porCidade ? x.impacto_cidade : x.impacto_geral);
      const aberto = E.aberto === x.chave;
      const dif = x.dif == null ? "" : Math.abs(x.dif) < 0.5 ? "igual à cidade" : `${x.dif > 0 ? "+" : "−"}${Math.round(Math.abs(x.dif))} min da cidade`;
      linhas.push(el("tr", { class: "mon-linha" + (aberto ? " aberta" : ""), onclick: (e) => { if (!e.target.closest("button")) abrir(x); } },
        el("td", { class: "meta", text: i + 1 }),
        el("td", {}, el("button", { class: "link-ficha mon-nome", type: "button", "aria-expanded": String(aberto), onclick: () => abrir(x) }, x.nome || x.id || "Sem nome"),
          el("span", { class: "meta mon-sub", text: [x.id ? `ID ${x.id}` : "Sem ID", x.cidade].join(" · ") })),
        el("td", { text: Number(x.pedidos).toLocaleString("pt-BR") }),
        el("td", {}, el("b", { text: x.atraso }), " ", el("span", { class: "meta", text: `(${n1(x.pct)}%)` })),
        el("td", {}, el("b", { text: x.tempo == null ? "—" : `${Math.round(x.tempo)} min` }), " ",
          el("span", { class: "mon-dif " + (x.dif > 0.5 ? "bad" : x.dif < -0.5 ? "ok" : ""), text: dif })),
        el("td", {}, el("div", { class: "mon-impacto" }, el("b", { class: "mon-cor-" + cor, text: sinal + n1(x.impacto_geral, 2) }),
          el("span", { class: "mon-imp-barra", "aria-hidden": "true" }, el("span", { class: cor, style: `width:${Math.round((imp / max) * 100)}%` })))),
        el("td", {}, el("b", { text: sinal + n1(x.impacto_cidade, 2) }), " ", el("span", { class: "meta", text: "pontos" })),
        el("td", { class: "mon-acoes" }, el("button", { class: "btn small", type: "button", onclick: () => App.pedidos.doEntregador(x) }, "Ver atrasados"))));
      if (aberto) linhas.push(el("tr", { class: "mon-det-tr" }, detalhe(x)));
    });
    box.replaceChildren(el("div", { class: "tablewrap mon-tabela" }, el("table", {},
      el("thead", {}, el("tr", {}, ["#", "Entregador", "Entregas", "Atrasos", "Tempo médio", "Impacto no SLA geral", "Impacto no SLA da cidade", ""].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", {}, linhas))),
      d.entregadores > d.lista.length ? el("div", { class: "actions mon-mais" }, el("button", { class: "btn", type: "button",
        onclick: () => { E.limite += 10; recarregar(); } }, `Mostrar mais 10 (${(d.entregadores - d.lista.length).toLocaleString("pt-BR")} restantes)`)) : el("span"));
  }

  let espera = null;
  const mudou = (k, v, ja) => { E.filtros[k] = v; E.limite = 10; E.aberto = null; E.detalhe = {}; clearTimeout(espera); espera = setTimeout(recarregar, ja ? 0 : 400); };
  $("#me-busca").addEventListener("input", (e) => mudou("busca", e.target.value));
  $("#me-cidade").addEventListener("change", (e) => mudou("cidade", e.target.value, true));
  $("#me-dias").addEventListener("change", (e) => mudou("dias", Number(e.target.value), true));
  $("#me-min").addEventListener("change", (e) => mudou("min", Number(e.target.value), true));
  $("#me-filtros").addEventListener("submit", (e) => e.preventDefault());
  document.querySelectorAll("[data-me-modo]").forEach((b) => b.addEventListener("click", () => mudou("modo", b.dataset.meModo, true)));

  // ---------- Cidade ----------
  const C = { dados: null, f: { cidade: "", bairro: "", de: "", ate: "", comparar: "anterior", ordem: "assoc", min: 30 }, modo: "atrasos", cel: null, limB: 10 };
  const CAUSA = { loja: "Espera na loja", entregador: "Atraso do entregador", aceite: "Demora para associar", rota: "Rota com vários pedidos", outras: "Soma de pequenas demoras" };
  const varTxt = (v) => (v == null ? "" : Math.abs(v) < 0.5 ? "igual ao anterior" : `${v > 0 ? "piorou" : "melhorou"} ${n1(Math.abs(v))} min`);
  const varCls = (v) => "mon-dif " + (v == null || Math.abs(v) < 0.5 ? "" : v > 0 ? "bad" : "ok");
  async function carregarCidade() {
    const f = C.f;
    C.dados = await rpc("monitor_cidade", { p_cidade: f.cidade || null, p_de: f.de || null, p_ate: f.ate || null, p_comparar: f.comparar, p_min: f.min });
  }
  async function recarregarCidade() { try { await carregarCidade(); } catch (e) { toast(msgErro(e)); } renderCidade(); }
  function mapaCidade(d) {
    const at = C.modo === "atrasos";
    const k = (dow, h) => d.mapa.find((x) => x.dow === dow && x.hora === h);
    const horas = []; for (let h = 10; h <= 23; h++) horas.push(h);
    const val = (x) => (!x ? null : at ? (x.pedidos ? (x.atraso * 100) / x.pedidos : null) : (x.pedidos + x.cancelados ? (x.cancelados * 100) / (x.pedidos + x.cancelados) : null));
    const vals = d.mapa.map(val).filter((v) => v != null);
    const max = Math.max(1, ...vals);
    const ordemDias = [1, 2, 3, 4, 5, 6, 0];
    const cel = C.cel && k(C.cel[0], C.cel[1]);
    const nivel = (v) => (v == null ? -1 : Math.min(4, Math.floor((v / max) * 5)));
    const piores = d.mapa.filter((x) => x.pedidos >= 20).map((x) => [val(x), x]).filter((y) => y[0] != null).sort((a, b) => b[0] - a[0]).slice(0, 3)
      .map(([v, x]) => `${DIAS[x.dow]} ${x.hora}h (${n1(v)}%)`);
    return el("section", { class: "panel mon-mapa" },
      el("div", { class: "mon-lista-cab" }, el("div", {}, el("h3", { text: "Quando acontece" }),
        el("p", { class: "meta", style: "margin:0", text: at ? `% de pedidos acima de ${d.limite} min, por dia da semana e hora do chamado.` : "% de pedidos cancelados, por dia da semana e hora do chamado." })),
        el("div", { class: "seg", role: "group", "aria-label": "O que mostrar no mapa" },
          ["atrasos", "cancelamentos"].map((m) => el("button", { type: "button", "aria-pressed": String(C.modo === m), onclick: () => { C.modo = m; renderCidade(); } }, m === "atrasos" ? "Atrasos" : "Cancelamentos")))),
      el("div", { class: "mon-mapa-corpo" },
        el("div", { class: "mon-mapa-grade", role: "grid", "aria-label": "Mapa por dia e hora" },
          el("div", { class: "mon-mapa-linha cab", role: "row" }, el("span"), horas.map((h) => el("span", { role: "columnheader", text: h + "h" }))),
          ordemDias.map((dw) => el("div", { class: "mon-mapa-linha", role: "row" }, el("span", { role: "rowheader", text: DIAS[dw].slice(0, 3) }),
            horas.map((h) => { const x = k(dw, h), v = val(x), on = C.cel && C.cel[0] === dw && C.cel[1] === h;
              return el("button", { type: "button", role: "gridcell", class: `mon-cel n${nivel(v)}${on ? " on" : ""}`, "aria-pressed": String(!!on),
                "aria-label": `${DIAS[dw]} ${h}h: ${v == null ? "sem pedidos" : n1(v) + "%"}`, onclick: () => { C.cel = [dw, h]; renderCidade(); },
                text: v == null ? "" : Math.round(v) }); })))),
        el("div", { class: "mon-mapa-lado" }, cel ? [
          el("span", { class: "mon-det-rot", text: "Horário escolhido" }), el("b", { text: `${DIAS[cel.dow]} ${cel.hora}h` }),
          el("div", { class: "mon-det-linha" }, el("span", { text: "Pedidos" }), el("b", { text: cel.pedidos })),
          at ? el("div", { class: "mon-det-linha" }, el("span", { text: `Acima de ${d.limite} min` }), el("b", { text: `${cel.atraso} (${n1(val(cel))}%)` }))
             : el("div", { class: "mon-det-linha" }, el("span", { text: "Cancelados" }), el("b", { text: `${cel.cancelados} (${n1(val(cel) ?? 0)}%)` })),
          at ? el("div", { class: "mon-det-linha" }, el("span", { text: "Impacto no SLA da cidade" }), el("b", { text: `−${n1((cel.atraso * 100) / (d.pedidos || 1), 2)} ponto` }))
             : el("p", { class: "meta", text: "Cancelamento não entra no SLA de entrega: aqui conta como pedido perdido." })]
          : el("p", { class: "meta", text: "Escolha um horário no mapa para ver os números." }),
          el("div", { class: "mon-legenda", "aria-hidden": "true" }, el("span", { text: "menos" }), [0, 1, 2, 3, 4].map((i) => el("span", { class: "mon-cel n" + i })), el("span", { text: "mais" })))),
      piores.length ? el("p", { class: "meta", text: "Piores horários: " + piores.join(", ") }) : null);
  }
  function renderCidade() {
    const d = C.dados, box = $("#mc-corpo");
    if (!d) return box.replaceChildren(carregandoEl());
    if (d.vazio) return box.replaceChildren(vazio("Ainda não há pedidos do Tableau", mod() ? "Envie os arquivos na aba Enviar dados." : "Quando um moderador enviar os dados do Tableau, a cidade aparece aqui."));
    const sel = $("#mc-cidade");
    sel.replaceChildren(...d.cidades.map((c) => el("option", { value: c, text: c }))); sel.value = d.cidade;
    if (!C.f.de) $("#mc-de").value = d.de; if (!C.f.ate) $("#mc-ate").value = d.ate;
    $("#mc-dados").textContent = `Dados do Tableau de ${App.u.dia(d.de)} a ${App.u.dia(d.ate)} · comparado com ${App.u.dia(d.comp_de)} a ${App.u.dia(d.comp_ate)}`;
    const busca = App.u.norm(C.f.bairro || "").toLowerCase();
    const ord = C.f.ordem;
    const bairros = d.bairros.filter((b) => !busca || App.u.norm(b.bairro).toLowerCase().includes(busca))
      .sort((a, b) => Number(b[ord] ?? -1) - Number(a[ord] ?? -1));
    const cidNome = d.cidade.replace(/ - [A-Z]{2}$/, "");
    const tabB = el("section", { class: "panel mon-sec" },
      el("div", { class: "mon-lista-cab" }, el("h3", { text: ord === "assoc" ? "Bairros com mais dificuldade para associar" : "Bairros" }),
        el("span", { class: "meta", text: `${plural(d.bairros.length, "bairro", "bairros")} · ${Number(d.pedidos || 0).toLocaleString("pt-BR")} entregas · SLA da cidade ${n1(d.sla)}%` })),
      bairros.length ? el("div", { class: "tablewrap mon-tabela" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Bairro", "Entregas", "Atrasadas", "Impacto no SLA da cidade", "Tempo até associar", "Tempo de entrega", "Cancelados", "Lojas mais pedidas", ""].map((h) => el("th", { scope: "col", text: h })))),
        el("tbody", {}, bairros.slice(0, C.limB).map((b) => el("tr", {},
          el("td", {}, el("b", { text: b.bairro })),
          el("td", { text: Number(b.pedidos).toLocaleString("pt-BR") }),
          el("td", {}, el("b", { class: b.pct >= 15 ? "mon-cor-bad" : "", text: b.atraso }), " ", el("span", { class: "meta", text: `(${n1(b.pct)}%)` })),
          el("td", {}, el("b", { class: "mon-cor-bad", text: `−${n1(b.impacto, 2)}` }), " ", el("span", { class: "meta", text: "pontos" })),
          el("td", {}, el("b", { text: b.assoc == null ? "—" : `${n1(b.assoc)} min` }), el("span", { class: varCls(b.assoc_var) + " mon-sub", text: varTxt(b.assoc_var) })),
          el("td", {}, el("b", { text: b.total == null ? "—" : `${Math.round(b.total)} min` }), el("span", { class: varCls(b.total_var) + " mon-sub", text: varTxt(b.total_var) })),
          el("td", {}, el("span", { text: b.cancelados }), b.sem_entregador ? el("span", { class: "meta mon-sub", text: `${b.sem_entregador} sem entregador` }) : null),
          el("td", { class: "meta", text: (b.lojas || []).join(", ") }),
          el("td", { class: "mon-acoes" }, el("button", { class: "btn small", type: "button", onclick: () => tarefaProcurar(d.cidade, b) }, "Procurar entregador"))))))) : el("p", { class: "meta", style: "padding:0 var(--s5)", text: "Nenhum bairro com esses filtros." }),
      bairros.length > C.limB ? el("div", { class: "actions mon-mais" }, el("button", { class: "btn", type: "button", onclick: () => { C.limB += 10; renderCidade(); } }, `Mostrar mais 10 (${bairros.length - C.limB} restantes)`)) : null,
      el("p", { class: "meta mon-nota", text: `Impacto = quantos pontos o SLA de ${cidNome} subiria sem os atrasos daquele bairro. Tempo até associar = do chamado até um entregador aceitar.` }));
    const tabL = el("section", { class: "panel mon-sec" },
      el("div", { class: "mon-lista-cab" }, el("h3", { text: "Parceiros com mais pedidos atrasados" }), el("span", { class: "meta", text: "lojas com 30 pedidos ou mais no período" })),
      d.lojas.length ? el("div", { class: "tablewrap mon-tabela" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Parceiro", "Pedidos", "Atrasados", "Impacto no SLA da cidade", "Espera na loja", "Causa mais comum", "Tendência", ""].map((h) => el("th", { scope: "col", text: h })))),
        el("tbody", {}, d.lojas.slice(0, 10).map((l) => {
          const dif = l.pct_antes == null ? null : l.pct - l.pct_antes;
          const tend = dif == null ? "sem comparação" : Math.abs(dif) < 1 ? "igual" : dif > 0 ? "piorou" : "melhorou";
          return el("tr", {},
            el("td", {}, el("b", { text: l.loja })),
            el("td", { text: l.pedidos }),
            el("td", {}, el("b", { text: l.atraso }), " ", el("span", { class: "meta", text: `(${n1(l.pct)}%)` })),
            el("td", {}, el("b", { class: "mon-cor-bad", text: `−${n1(l.impacto, 2)}` }), " ", el("span", { class: "meta", text: "pontos" })),
            el("td", { text: l.espera == null ? "—" : `${Math.round(l.espera)} min` }),
            el("td", { text: CAUSA[l.causa] || "—" }),
            el("td", {}, el("span", { class: "mon-dif " + (tend === "piorou" ? "bad" : tend === "melhorou" ? "ok" : ""), text: tend })),
            el("td", { class: "mon-acoes" }, el("button", { class: "btn small", type: "button", onclick: () => App.registrarAcordo?.(l.loja, d.cidade) }, "Registrar acordo")));
        })))) : el("p", { class: "meta", style: "padding:0 var(--s5) var(--s4)", text: "Nenhuma loja com 30 pedidos ou mais e atrasos no período." }));
    box.replaceChildren(tabB, tabL, mapaCidade(d));
  }
  function tarefaProcurar(cidade, b) {
    App.u.janela("Criar tarefa: Procurar entregador",
      el("p", { style: "margin:0", text: `${b.bairro} · ${cidade}` }),
      el("p", { class: "meta", text: `Tempo até associar: ${b.assoc == null ? "—" : n1(b.assoc) + " min"} · ${b.sem_entregador} cancelados sem entregador no período. A tarefa fica aberta para a equipe em Atividades → Tarefas.` }),
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          const bt = e.currentTarget; bt.disabled = true;
          try {
            await rpc("criar_tarefa", { p_tipo: "procurar_entregador", p_campos: { cidade, detalhe: `Bairro ${b.bairro}: demora para associar (${n1(b.assoc)} min em média)` }, p_para: [] });
            bt.closest("dialog").close(); toast("Tarefa criada para a equipe.");
          } catch (err) { bt.disabled = false; toast(msgErro(err)); }
        } }, "Criar tarefa"),
        el("button", { class: "btn link", type: "button", onclick: (e) => e.currentTarget.closest("dialog").close() }, "Cancelar")));
  }
  const mudouC = (k, v, ja) => { C.f[k] = v; C.limB = 10; clearTimeout(espera); espera = setTimeout(recarregarCidade, ja ? 0 : 400); };
  $("#mc-cidade").addEventListener("change", (e) => { C.f.de = ""; C.f.ate = ""; $("#mc-de").value = ""; $("#mc-ate").value = ""; C.cel = null; mudouC("cidade", e.target.value, true); });
  $("#mc-de").addEventListener("change", (e) => mudouC("de", e.target.value, true));
  $("#mc-ate").addEventListener("change", (e) => mudouC("ate", e.target.value, true));
  $("#mc-comparar").addEventListener("change", (e) => mudouC("comparar", e.target.value, true));
  $("#mc-min").addEventListener("change", (e) => mudouC("min", Number(e.target.value), true));
  $("#mc-bairro").addEventListener("input", (e) => { C.f.bairro = e.target.value; renderCidade(); });
  $("#mc-ordem").addEventListener("change", (e) => { C.f.ordem = e.target.value; renderCidade(); });
  $("#mc-filtros").addEventListener("submit", (e) => e.preventDefault());

  // ---------- Calendário ----------
  // Pedidos do usuário (28/11): abre sem dia escolhido; tempo e cancelamentos valem 1 ponto pela semana passada e 1 pelo
  // mês passado; 5 níveis (o último, "extremo"). A previsão do tempo é buscada aqui no navegador, uma vez por cidade por
  // dia, e guardada no banco (salvar_clima): quem abrir depois só lê.
  const K = { dados: null, cidade: "", mes: null, sel: null, buscandoClima: {} };
  const NIVEIS = ["Tranquilo", "Atenção", "Alto", "Crítico", "Extremo"];
  const ACOES = [["mensagem", "Mensagem de convocação aos entregadores"], ["missao", "Sugerir missão para os entregadores"],
    ["aviso_geral", "Aviso geral para a equipe"], ["avisar_parceiros", "Avisar os parceiros com mais atraso sobre possível demora"]];
  const isoDia = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const UFS = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
    GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
    PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
    SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins" };
  async function carregarCalendario() {
    K.dados = await rpc("monitor_calendario", { p_cidade: K.cidade || null, p_mes: K.mes });
    if (!K.dados.vazio) { K.cidade = K.dados.cidade; buscarClima(); }
  }
  async function recarregarCalendario() { try { await carregarCalendario(); } catch (e) { toast(msgErro(e)); } renderCalendario(); }
  // OpenWeatherMap: acha a cidade (nome + estado) e soma a previsão de 3 em 3 horas por dia de Brasília
  async function buscarClima() {
    const d = K.dados, cid = d.cidade;
    if (!d.tem_chave || K.buscandoClima[cid]) return;
    if (d.clima_em && App.u.diaChave(d.clima_em) === App.u.diaChave(new Date().toISOString())) return;
    K.buscandoClima[cid] = true;
    try {
      const chave = await rpc("chave_clima");
      if (!chave) return;
      const [nome, uf] = cid.split(" - ");
      let pos = null;
      try { pos = JSON.parse(localStorage.getItem("comunique-geo-" + cid) || "null"); } catch { /* sem armazenamento */ }
      if (!pos) {
        const g = await (await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(nome)},BR&limit=5&appid=${chave}`)).json();
        const achado = (Array.isArray(g) ? g : []).find((x) => !uf || x.state === UFS[uf]) || (Array.isArray(g) ? g[0] : null);
        if (!achado) return;
        pos = { lat: achado.lat, lon: achado.lon };
        try { localStorage.setItem("comunique-geo-" + cid, JSON.stringify(pos)); } catch { /* ok */ }
      }
      const f = await (await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${pos.lat}&lon=${pos.lon}&units=metric&lang=pt_br&appid=${chave}`)).json();
      const dias = {};
      for (const x of f.list || []) {
        const dt = new Date(x.dt * 1000), dia = App.u.diaChave(dt.toISOString());
        const hora = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: App.u.FUSO, hour: "2-digit", hourCycle: "h23" }).format(dt));
        const o = dias[dia] || (dias[dia] = { dia, chance: 0, chuva_mm: 0, descricao: null, horas: [] });
        const pop = Math.round((x.pop || 0) * 100), mm = x.rain?.["3h"] || 0;
        o.chuva_mm += mm;
        if (pop > o.chance) { o.chance = pop; o.descricao = x.weather?.[0]?.description || null; }
        if (pop >= 40 || mm >= 1) o.horas.push(hora);
      }
      const itens = Object.values(dias).map((o) => ({ dia: o.dia, chance: o.chance, chuva_mm: Math.round(o.chuva_mm * 10) / 10, descricao: o.descricao,
        das: o.horas.length ? Math.min(...o.horas) + "h" : null, ate: o.horas.length ? Math.min(23, Math.max(...o.horas) + 3) + "h" : null }));
      if (!itens.length) return;
      await rpc("salvar_clima", { p_cidade: cid, p_itens: itens });
      K.dados = await rpc("monitor_calendario", { p_cidade: cid, p_mes: K.mes });
      renderCalendario();
    } catch (e) { console.warn("Previsão do tempo:", e); }
  }
  function renderCalendario() {
    const d = K.dados, box = $("#mk-corpo");
    if (!d) return box.replaceChildren(carregandoEl());
    if (d.vazio) return box.replaceChildren(vazio("Ainda não há pedidos do Tableau", mod() ? "Envie os arquivos na aba Enviar dados." : "Quando um moderador enviar os dados do Tableau, o calendário aparece aqui."));
    $("#mk-cidades").replaceChildren(...d.cidades.map((c) => el("button", { type: "button", "aria-pressed": String(c === d.cidade),
      onclick: () => { K.cidade = c; K.sel = null; recarregarCalendario(); } }, c)));
    $("#mk-cidades").hidden = d.cidades.length <= 1;
    $("#mk-dados").textContent = `Dados do Tableau até ${d.ultimo_dado ? App.u.dia(d.ultimo_dado) : "—"}${d.clima_em ? ` · previsão do tempo de ${App.u.dt(d.clima_em)}` : d.tem_chave ? "" : " · sem previsão do tempo"}`;
    const hoje = d.hoje, futuros = d.dias.filter((x) => x.dia >= hoje), mesNome = new Date(d.mes + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const prox = futuros.find((x) => x.nivel >= 3);
    const card = (v, t) => el("div", { class: "mon-num" }, el("span", { class: "mon-num-val", text: v }), el("span", { class: "meta", text: t }));
    const risco = futuros.filter((x) => x.nivel >= 1);
    const numeros = el("div", { class: "mon-numeros cinco" },
      card(prox ? App.u.dia(prox.dia).slice(0, 5) : "—", "próximo dia crítico"),
      card(d.dias.filter((x) => x.nivel >= 1).length, "dias de atenção ou mais no mês"),
      card(d.dias.filter((x) => x.nivel >= 3).length, "dias críticos ou extremos no mês"),
      card(futuros.filter((x) => x.planejado).length, "próximos dias com planejamento"),
      card(risco.filter((x) => !x.planejado).length, "dias de risco sem planejamento"));
    const passados = d.dias.filter((x) => x.dia < hoje);
    const mudaMes = (n) => { const m = new Date(d.mes + "T12:00:00"); m.setMonth(m.getMonth() + n); K.mes = isoDia(m).slice(0, 8) + "01"; K.sel = null; recarregarCalendario(); };
    const primeiroDow = new Date(d.mes + "T12:00:00").getDay();
    const vazios = Array.from({ length: primeiroDow }, () => el("span", { class: "mon-dia vazio", "aria-hidden": "true" }));
    const cal = el("section", { class: "panel mon-cal" },
      el("div", { class: "mon-cal-cab" },
        el("div", { class: "actions", style: "margin:0" },
          el("button", { class: "btn small", type: "button", "aria-label": "Mês anterior", onclick: () => mudaMes(-1) }, "‹"),
          el("h3", { text: mesNome }),
          el("button", { class: "btn small", type: "button", "aria-label": "Próximo mês", onclick: () => mudaMes(1) }, "›")),
        el("div", { class: "mon-cal-resumo" },
          el("span", { text: `Já aconteceu: ${passados.filter((x) => x.nivel >= 3).length} críticos ou extremos, ${passados.filter((x) => x.nivel === 2).length} altos` }),
          el("span", { text: `Previsão: ${futuros.filter((x) => x.nivel >= 3).length} críticos ou extremos, ${futuros.filter((x) => x.nivel === 1 || x.nivel === 2).length} de atenção ou altos, chuva em ${futuros.filter((x) => x.p_clima > 0).length} ${futuros.filter((x) => x.p_clima > 0).length === 1 ? "dia" : "dias"}` }))),
      el("div", { class: "mon-cal-grade" },
        ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((x) => el("span", { class: "mon-cal-sem", text: x })),
        vazios,
        d.dias.map((x) => {
          const futuro = x.dia >= hoje, n = Number(x.dia.slice(8));
          const marcas = [x.p_clima > 0 ? "chuva" : null, x.p_tempo > 0 ? "tempo" : null, x.p_canc > 0 ? "cancel." : null, x.planejado ? "planejado" : null].filter(Boolean);
          const res = futuro ? null : resultado(x);
          return el("button", { type: "button", class: `mon-dia ${futuro ? "f" : "p"}${x.nivel}${x.dia === hoje ? " hoje" : ""}${K.sel === x.dia ? " on" : ""}`,
            "aria-pressed": String(K.sel === x.dia),
            "aria-label": `${App.u.dia(x.dia)}: ${NIVEIS[x.nivel]}, ${futuro ? "previsão" : "já aconteceu"}${res ? ", " + res.toLowerCase() : ""}${marcas.length ? " · " + marcas.join(", ") : ""}`,
            onclick: () => { K.sel = K.sel === x.dia ? null : x.dia; renderCalendario(); } },
            el("span", { class: "num", text: n }), x.dia === hoje ? el("span", { class: "niv", text: "Hoje" }) : null,
            el("span", { class: "niv", text: NIVEIS[x.nivel] }),
            res ? el("span", { class: "res", text: res }) : null,
            marcas.length ? el("span", { class: "marcas" }, marcas.map((m) => el("span", { text: m }))) : null);
        })),
      el("div", { class: "mon-cal-leg" }, NIVEIS.map((t, i) => el("span", {}, el("i", { class: "f" + i }), t + " (previsão)")),
        el("span", {}, el("i", { class: "p2" }), "cor clara = já aconteceu")));
    const partes = [numeros, cal];
    const x = K.sel && d.dias.find((y) => y.dia === K.sel);
    if (x) partes.push(detalheDia(d, x));
    if (mod() && !d.tem_chave) partes.push(chaveClima());
    box.replaceChildren(...partes);
  }
  // dia que já passou: melhor ou pior que o mesmo dia da semana passada (tempo de entrega e cancelamentos)
  function comparar(v, ref, tolerancia) {
    if (v == null || ref == null) return null;
    return v > ref + tolerancia ? "pior" : v < ref - tolerancia ? "melhor" : "igual";
  }
  function resultado(x) {
    if (x.pedidos == null) return null;
    const t = comparar(x.tempo, x.s_tempo, (x.s_tempo || 0) * 0.05), c = comparar(x.canc_pct, x.s_canc, 0.5);
    const r = [t, c].filter(Boolean);
    if (!r.length) return "Sem comparação";
    return r.includes("pior") && r.includes("melhor") ? "Misto" : r.includes("pior") ? "Pior que a semana passada" : r.includes("melhor") ? "Melhor que a semana passada" : "Igual à semana passada";
  }
  function detalheDia(d, x) {
    const futuro = x.dia >= d.hoje, sem = DIAS[new Date(x.dia + "T12:00:00").getDay()];
    const pts = (p) => el("span", { class: "mon-pts p" + p, text: `+${p} ${p === 1 ? "ponto" : "pontos"}` });
    const minT = (v) => (v == null ? "—" : `${Math.round(v)} min`), pctT = (v) => (v == null ? "—" : `${n1(v)}%`);
    const clima = x.chance == null ? ["Sem previsão", d.tem_chave ? "a previsão sai até 5 dias antes" : "falta a chave do OpenWeatherMap"]
      : [x.descricao ? x.descricao[0].toUpperCase() + x.descricao.slice(1) : x.p_clima ? "Chuva" : "Sem chuva",
         `${x.chance}% de chance${x.chuva_mm ? `, ${n1(x.chuva_mm)} mm` : ""}${x.das ? `, das ${x.das} às ${x.ate}` : ""}`];
    const fator = (rot, v, sub, p) => el("div", { class: "mon-fator" }, el("span", { class: "mon-det-rot", text: rot }), el("b", { class: "v", text: v }), el("span", { class: "meta", text: sub }), pts(p));
    const comp = el("div", { class: "tablewrap" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Indicador", futuro ? "—" : "Este dia", `Mesmo dia da semana passada`, "Mesmo dia do mês passado", "Média de 4 semanas", ...(futuro ? [] : ["Resultado"])].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", {},
        el("tr", {}, el("td", { text: "Tempo de entrega" }), el("td", { text: futuro ? "—" : minT(x.tempo) }), el("td", { text: minT(x.s_tempo) }), el("td", { text: minT(x.m_tempo) }), el("td", { text: minT(d.media?.tempo) }),
          futuro ? null : celRes(x.tempo == null ? null : `${difTxt(x.tempo - (x.s_tempo ?? x.tempo), " min")} na semana · ${difTxt(x.tempo - (x.m_tempo ?? x.tempo), " min")} no mês`, comparar(x.tempo, x.s_tempo, (x.s_tempo || 0) * 0.05))),
        el("tr", {}, el("td", { text: "Cancelamentos" }), el("td", { text: futuro ? "—" : pctT(x.canc_pct) }), el("td", { text: pctT(x.s_canc) }), el("td", { text: pctT(x.m_canc) }), el("td", { text: pctT(d.media?.canc_pct) }),
          futuro ? null : celRes(x.canc_pct == null ? null : `${difTxt(x.canc_pct - (x.s_canc ?? x.canc_pct), " p.p.")} na semana · ${difTxt(x.canc_pct - (x.m_canc ?? x.canc_pct), " p.p.")} no mês`, comparar(x.canc_pct, x.s_canc, 0.5))),
        el("tr", {}, el("td", { text: "Pedidos" }), el("td", { text: futuro ? "—" : x.pedidos ?? "—" }), el("td", { text: x.s_pedidos ?? "—" }), el("td", { text: "—" }), el("td", { text: "—" }),
          futuro ? null : el("td", { text: x.pedidos != null && x.s_pedidos ? difTxt(x.pedidos - x.s_pedidos, "") + " na semana" : "—" })))));
    return el("section", { class: "panel mon-dia-det", "aria-label": "Dia escolhido" },
      el("div", { class: "mon-lista-cab", style: "padding:0;border:0" },
        el("h3", { text: `${sem}, ${App.u.dia(x.dia)}` }),
        el("span", { class: `pill ${x.nivel >= 3 ? "bad" : x.nivel >= 1 ? "warn" : "ok"}`, text: `${NIVEIS[x.nivel]} ${futuro ? "(previsão)" : "(aconteceu)"} · ${plural(x.pontos, "ponto", "pontos")}` }),
        el("button", { class: "btn link", type: "button", onclick: () => { K.sel = null; renderCalendario(); } }, "Fechar")),
      el("div", { class: "mon-fatores" },
        fator("Clima", clima[0], clima[1], x.p_clima),
        fator("Tempo de entrega", futuro ? `${minT(x.s_tempo)} · ${minT(x.m_tempo)}` : minT(x.tempo), futuro ? "semana passada · mês passado, contra a média" : `semana passada ${minT(x.s_tempo)} · mês passado ${minT(x.m_tempo)}`, x.p_tempo),
        fator("Cancelamentos", futuro ? `${pctT(x.s_canc)} · ${pctT(x.m_canc)}` : pctT(x.canc_pct), futuro ? "semana passada · mês passado, contra a média" : `semana passada ${pctT(x.s_canc)} · mês passado ${pctT(x.m_canc)}`, x.p_canc)),
      el("h4", { text: "Comparativo" }), comp,
      x.pior_hora != null ? el("p", { class: "meta", text: `Horário que mais pesou: ${x.pior_hora}h às ${x.pior_hora + 1}h.` }) : null,
      planejamento(d, x, futuro));
  }
  const difTxt = (v, un) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${n1(Math.abs(v), Math.abs(v) >= 10 || un === "" ? 0 : 1)}${un}`);
  const celRes = (txt, r) => el("td", {}, r ? el("b", { class: r === "pior" ? "mon-cor-bad" : r === "melhor" ? "mon-cor-ok" : "", text: r[0].toUpperCase() + r.slice(1) }) : null,
    txt ? el("span", { class: "meta mon-sub", text: txt }) : null);
  function planejamento(d, x, futuro) {
    const pl = x.plano;
    if (!futuro) return pl ? el("div", { class: "mon-plano" }, el("h4", { text: "O que foi planejado" }),
      el("p", { text: [pl.convocar ? `${pl.convocar} entregadores a convocar` : null, pl.reforco_de ? `reforço das ${pl.reforco_de} às ${pl.reforco_ate}` : null].filter(Boolean).join(" · ") || "Sem números" }),
      (pl.acoes || []).length ? el("p", { class: "meta", text: (pl.acoes || []).map((a) => ACOES.find((y) => y[0] === a)?.[1]).filter(Boolean).join(" · ") }) : null,
      pl.observacao ? el("p", { text: pl.observacao }) : null) : null;
    const pode = ["moderador", "monitorador"].includes(papel());
    if (!pode) return pl ? el("div", { class: "mon-plano" }, el("h4", { text: "Planejamento do dia" }), el("p", { class: "meta", text: `Planejado por ${pl.por || "alguém"}.` })) : null;
    const conv = el("input", { type: "number", min: 0, max: 500, value: pl?.convocar ?? "" });
    const de = el("input", { type: "time", value: pl?.reforco_de || "" }), ate = el("input", { type: "time", value: pl?.reforco_ate || "" });
    const caixas = ACOES.map(([k, t]) => el("label", {}, el("input", { type: "checkbox", value: k, checked: (pl?.acoes || []).includes(k) }), " ", t));
    const obs = el("textarea", { rows: 2, maxlength: 600 }); obs.value = pl?.observacao || "";
    const erro = el("p", { class: "warn-msg", role: "alert", hidden: true });
    return el("form", { class: "mon-plano", onsubmit: async (e) => {
      e.preventDefault(); const bt = e.submitter; if (bt) bt.disabled = true; erro.hidden = true;
      try {
        await rpc("salvar_planejamento", { p_cidade: d.cidade, p_dia: x.dia, p_convocar: conv.value === "" ? null : Number(conv.value),
          p_reforco_de: de.value || null, p_reforco_ate: ate.value || null,
          p_acoes: caixas.map((c) => c.querySelector("input")).filter((c) => c.checked).map((c) => c.value), p_observacao: obs.value });
        toast("Planejamento salvo."); await recarregarCalendario();
      } catch (err) { erro.textContent = msgErro(err); erro.hidden = false; if (bt) bt.disabled = false; }
    } },
      el("h4", { text: "Planejamento do dia" }),
      el("div", { class: "linha" }, el("label", {}, "Entregadores a convocar", conv), el("label", {}, "Reforço das", de), el("label", {}, "até", ate)),
      el("fieldset", {}, el("legend", { text: "O que fazer antes" }), caixas),
      el("label", {}, "Observações", obs), erro,
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "submit" }, "Salvar planejamento"),
        el("span", { class: "meta", text: "Depois do dia, o planejado aparece ao lado do que aconteceu." })));
  }
  function chaveClima() {
    const inp = el("input", { class: "mono", autocomplete: "off", spellcheck: "false", placeholder: "Chave da API" });
    return el("form", { class: "panel mon-dia-det", onsubmit: async (e) => {
      e.preventDefault();
      try { await rpc("salvar_chave_clima", { p_chave: inp.value.trim() }); toast("Chave salva. A previsão aparece em seguida."); await recarregarCalendario(); }
      catch (err) { toast(msgErro(err)); }
    } }, el("h4", { text: "Previsão do tempo" }),
      el("p", { class: "meta", text: "Cole a chave do OpenWeatherMap (openweathermap.org, em API keys). Ela fica guardada no banco e só é lida por quem é da equipe." }),
      el("div", { class: "linha", style: "display:flex;gap:8px;flex-wrap:wrap" }, inp, el("button", { class: "btn primary", type: "submit" }, "Salvar chave")));
  }

  App.monitoramento = { E, carregar, render };
  App.modulo({
    id: "monitoramento", nome: "Monitoramento",
    acesso: () => !!papel(),
    abas: [{ id: "entregadores", nome: "Entregadores", secao: "v-mon-entregadores" },
           { id: "parceiros", nome: "Parceiros", secao: "v-pa-sem" },
           { id: "cidade", nome: "Cidade", secao: "v-mon-cidade" },
           { id: "calendario", nome: "Calendário", secao: "v-mon-calendario" },
           { id: "atrasados", nome: "Pedidos atrasados", secao: "v-bq-pedidos", oculta: true, dono: "entregadores" },
           // 009z18b (pedido do usuário): "Enviar dados" é o botão do canto do título, como no desenho, e não uma aba
           { id: "enviar", nome: "Enviar dados", secao: "v-mon-enviar", pode: mod, oculta: true }],
    padrao: () => "entregadores",
    async carregar(aba) {
      if (aba === "enviar") return;
      if (aba === "parceiros") return App.semChamar?.carregar();
      if (aba === "cidade") return carregarCidade();
      if (aba === "calendario") return carregarCalendario();
      if (aba === "atrasados") {
        const B = App.bloqueios?.B;   // as cidades da janela de registrar vêm das regras das Restrições
        return Promise.all([App.pedidos.carregar(), B && !B.regras ? rpc("regras_bloqueio").then((d) => { B.regras = d; B.regrasEm = Date.now(); }) : null]);
      }
      return carregar();
    },
    render(aba) {
      document.querySelectorAll("[data-mon-enviar]").forEach((b) => (b.hidden = !mod()));
      if (aba === "enviar") App.pedidos.renderImportar();
      else if (aba === "parceiros") App.semChamar?.render();
      else if (aba === "cidade") renderCidade();
      else if (aba === "calendario") renderCalendario();
      else if (aba === "atrasados") App.pedidos.render();
      else render();
    },
  });
})();
