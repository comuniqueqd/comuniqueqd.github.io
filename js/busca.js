// Busca rápida no topo (ID, CPF ou nome → ficha do entregador ou cadastro da ativação) e a
// janela "O que há de novo", que aparece uma vez por pessoa a cada versão publicada.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, fmtCPF, rpc, msgErro, janela } = App.u;
  const S = App.S;

  // ---------- busca rápida ----------
  const form = $("#busca-topo"), campo = $("#q-topo"), res = $("#busca-res");
  let tempo = null, ultima = "";
  const fechar = () => { res.hidden = true; };
  const ir = (f) => { fechar(); campo.value = ""; ultima = ""; campo.blur(); f(); };
  async function buscar() {
    const q = campo.value.trim();
    if (q === ultima) return;
    ultima = q;
    if (q.length < 3) return fechar();
    let r;
    try { r = await rpc("busca_rapida", { p_q: q }); } catch (e) { res.replaceChildren(el("p", { class: "meta", style: "margin:6px 8px", text: msgErro(e) })); res.hidden = false; return; }
    if (q !== campo.value.trim()) return;
    const bloq = !!S.me?.papel_bloqueios;
    const linhas = [];
    if (r.entregadores.length) linhas.push(el("h4", { text: "Entregadores" }), ...r.entregadores.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(x.id_app)) },
        el("span", { text: x.nome || "(sem nome)" }),
        el("span", { class: "meta mono", text: `${x.id_app} · ${x.cidade || "sem cidade"} · ${x.bloqueios} bloqueio(s)` }))));
    if (r.cadastros.length) linhas.push(el("h4", { text: "Cadastros da ativação" }), ...r.cadastros.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirCadastro(x.id)) },
        el("span", { text: x.nome || (x.id_app ? "ID " + x.id_app : "CPF " + fmtCPF(x.cpf)) }),
        el("span", { class: "meta mono", text: [x.id_app, x.cpf && fmtCPF(x.cpf), x.cidade, x.situacao].filter(Boolean).join(" · ") }))));
    // lupa: comentários sobre entregadores e os seus avisos
    const corta = (t, n = 90) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    if (r.comentarios?.length) linhas.push(el("h4", { text: "Comentários" }), ...r.comentarios.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(x.id_app)) },
        el("span", { text: corta(x.texto) }),
        el("span", { class: "meta", text: `${x.nome || x.id_app} · ${x.por_nome || "—"} · ${dt(x.em)}` }))));
    if (r.avisos?.length) linhas.push(el("h4", { text: "Seus avisos" }), ...r.avisos.map((x) =>
      el("button", { type: "button", onclick: () => ir(() => (location.hash = x.link || "#atividades/avisos")) },
        el("span", { text: corta(x.texto) }), el("span", { class: "meta", text: dt(x.criada_em) }))));
    if (!linhas.length) linhas.push(el("p", { class: "meta", style: "margin:6px 8px", text: "Nada encontrado." }));
    if (bloq) linhas.push(el("button", { type: "button", onclick: () => ir(() => App.abrirFicha(q)) }, el("span", { class: "meta", text: `Consultar “${q}” na tela Consultar entregador →` })));
    res.replaceChildren(...linhas);
    res.hidden = false;
  }
  campo.addEventListener("input", () => { clearTimeout(tempo); tempo = setTimeout(buscar, 300); });
  campo.addEventListener("focus", () => { if (res.childElementCount && campo.value.trim().length >= 3) res.hidden = false; });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(tempo); ultima = ""; buscar(); });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") { fechar(); campo.blur(); } });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) fechar(); });

  // ---------- o que há de novo ----------
  const VERSAO = "008c";
  // 008, 008b e 008c saem como atualizações ligadas: cada uma no seu bloco, da mais nova para a mais antiga
  // (pedido do usuário: acrescentar as novas sem tirar as anteriores).
  const VERSOES = [
    { versao: "008c", tema: "🧭 Tudo mais à mão", itens: [
      ["Tela inicial com atalhos", "Nova ativação, Novo bloqueio, Cadastrar entregador, Sugerir atividade e Registros viraram botões grandes, logo no início. Os seus números ficaram embaixo, mais discretos."],
      ["Começa pelo que mais se faz", "Ativação abre no Novo cadastro (Pendentes vem em seguida, com o número na aba) e Bloqueios abre no Novo bloqueio (depois, as Tratativas)."],
      ["Menos telas", "“Meus cadastros” e “Meus registros” viraram o Histórico de cada módulo (quem é do suporte vê ali só o que enviou). Os Painéis viraram parte das Análises."],
      ["Análises simples e complexas", "Nas simples: por que não aprovou, quem sai do bloqueio hoje, bloqueados por cidade, quando você registra (e o seu pico), o que você fez no período, gráficos por dia e mais. Nas complexas: qual infração mais se repete, escada da reincidência, cidades, tempo de resposta da ativação, punições desfeitas e por pessoa."],
      ["Mais leve", "O app só recarrega as listas quando algo mudou de verdade: menos espera e menos consumo."],
    ] },
    { versao: "008b", tema: "📣 Espião ou fofoqueiro? Virou rede social?", itens: [
      ["Sino com tira", "Clique no sino: os avisos recentes abrem ali mesmo. Clicar num aviso leva direto para a ficha ou o cadastro."],
      ["Avisos com busca e filtros", "Busque por nome, ID, cidade ou palavra; filtre por tipo, cidade ou só os não lidos."],
      ["Sua cidade, seus avisos", "O responsável da cidade recebe tudo o que acontece nela; os moderadores recebem tudo. Cidade sem responsável? Peça para ser a responsável na tela de Avisos."],
      ["O suporte também revisa", "Registros marcados “revisar” e os que você registrou podem ser corrigidos pelo suporte (com motivo); e “Os dados estão certos” nos cadastros."],
    ] },
    { versao: "008", tema: "🕵️ Espionagem profissional", itens: [
      ["Cadastrar entregador", "A ficha do entregador (ID, nome e cidade) pode ser criada sem ativar nem bloquear."],
      ["Menu mais enxuto", "Ativação, Bloqueios e Cadastrar entregador ficam dentro de Entregadores, numa segunda barra."],
      ["Busca do topo mais esperta", "A busca acha também comentários sobre entregadores e os seus avisos."],
      ["Casos suspeitos: em revisão", "A tela de casos saiu por enquanto e vai voltar revisada."],
    ] },
  ];
  const NOVIDADES = { tema: VERSOES[0].tema, versoes: VERSOES, itens: VERSOES.flatMap((v) => v.itens) };

  // grava na hora (o evento "close" chega um instante depois; recarregar logo em seguida perderia a marca)
  const marcarVisto = () => { try { localStorage.setItem("comunique-novidades", VERSAO); } catch (_) {} };
  function mostrarNovidades() {
    let visto = null;
    try { visto = localStorage.getItem("comunique-novidades"); } catch (_) {}
    if (visto === VERSAO) return;
    const d = janela("O que há de novo",
      ...VERSOES.map((v, i) => el("div", { class: "bloco-versao" + (i ? " antiga" : "") },
        el("h4", {}, el("span", { class: "tag", text: v.versao }), " ", v.tema),
        el("ol", { class: "novidades" }, v.itens.map(([t, x]) => el("li", {}, el("b", { text: t + ": " }), x))))),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: () => { marcarVisto(); d.close(); } }, "Entendi")));
    d.addEventListener("close", marcarVisto);  // o ✕ e o Esc também contam como visto
  }

  App.aoEntrar.push(() => { form.hidden = false; }, mostrarNovidades);
  App.novidades = { VERSAO, NOVIDADES, mostrar: () => { try { localStorage.removeItem("comunique-novidades"); } catch (_) {} mostrarNovidades(); } };
})();
