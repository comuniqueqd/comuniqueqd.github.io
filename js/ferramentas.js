// Módulo "Ferramentas" (009b): funções do dia a dia.
// - Calculadora de bairro: cidade + bairro informado pelo cliente + bairro real → quanto falta pagar ao
//   entregador (ele recebe valor − taxa do log; ajuste = real − informado, nunca negativo) e registra o
//   ajuste no Financeiro (registrar_ajuste_bairro), com "já lancei no sistema?".
// - Tarifas: consulta dos bairros (todos) e edição (moderador da ativação, salvar_bairro).
(() => {
  "use strict";
  const App = window.App;
  const { $, el, dt, toast, vazio, carregandoEl, rpc, msgErro, tabela, janela } = App.u;
  const S = App.S;
  const F = { dados: null, erro: null, cidade: "", tCidade: "" };
  const render = () => App.render();
  const brl = (v) => (v == null ? "—" : "R$ " + Number(v).toFixed(2).replace(".", ","));
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  App.brl = brl;

  const bairrosDa = (cidade, inativos = false) => (F.dados?.bairros || []).filter((b) => b.cidade === cidade && (inativos || b.ativo));
  // acha pelo nome ou apelido, sem acento e sem diferenciar maiúsculas
  function achar(cidade, txt) {
    const q = norm(txt);
    if (!q) return null;
    const lista = bairrosDa(cidade);
    return lista.find((b) => norm(b.nome) === q) || lista.find((b) => b.apelidos.some((a) => norm(a) === q)) || null;
  }

  // ---------- calculadora ----------
  const form = $("#fe-form"), erro = $("#fe-erro");
  const calc = () => {
    const c = $("#fe-cidade").value;
    const bi = achar(c, $("#fe-informado").value), br = achar(c, $("#fe-real").value);
    return { c, bi, br, dif: bi && br ? Math.round((br.recebe - bi.recebe) * 100) / 100 : null };
  };
  $("#fe-id").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "")));
  $("#fe-cidade").addEventListener("change", (e) => { F.cidade = e.target.value; $("#fe-informado").value = ""; $("#fe-real").value = ""; renderCalc(); });
  ["#fe-informado", "#fe-real"].forEach((s) => $(s).addEventListener("input", () => renderResultado()));
  form.addEventListener("input", () => { erro.hidden = true; });
  form.addEventListener("reset", () => { erro.hidden = true; setTimeout(() => { $("#fe-cidade").value = F.cidade; renderResultado(); $("#fe-informado").focus(); }); });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const { c, bi, br } = calc();
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (!bi || !br) return falha("Escolha os dois bairros da lista.");
    if ($("#fe-id").value.trim().length < 4) return falha("Digite o ID do entregador.");
    if (!$("#fe-origem").value) return falha("Escolha de onde veio o pedido (QD ou outros).");
    const btn = $("#fe-enviar");
    btn.disabled = true;
    try {
      const r = await rpc("registrar_ajuste_bairro", { p_cidade: c, p_informado: bi.nome, p_real: br.nome, p_id_app: $("#fe-id").value.trim(),
        p_nome: $("#fe-nome").value.trim() || null, p_origem: $("#fe-origem").value, p_lancado: $("#fe-lancado").checked,
        p_pedido: $("#fe-pedido").value.trim() || null, p_motivo: $("#fe-motivo").value || null });
      toast(r.lancado ? `Ajuste de ${brl(r.valor)} registrado.` : `Ajuste de ${brl(r.valor)} registrado. Ficou em Adicionais pendentes até ser lançado.`);
      form.reset();
      App.carregar();
    } catch (e) { falha(msgErro(e)); } finally { btn.disabled = false; }
  });

  function renderCalc() {
    const cidades = (F.dados?.cidades || []).filter((c) => c.bairros > 0);
    const sel = $("#fe-cidade");
    if (sel.options.length !== cidades.length + 1) {
      sel.replaceChildren(el("option", { value: "", text: cidades.length ? "Escolha a cidade" : "Nenhuma cidade com bairros cadastrados" }),
        ...cidades.map((c) => el("option", { value: c.nome, text: c.nome })));
    }
    if (!F.cidade && cidades.length === 1) F.cidade = cidades[0].nome;
    sel.value = F.cidade;
    $("#fe-km").hidden = !(F.dados?.cidades || []).some((c) => c.tarifa_tipo === "km");
    // sugestões: nomes e apelidos da cidade
    const dl = $("#fe-bairros"), lista = bairrosDa(F.cidade);
    if (dl.dataset.cidade !== F.cidade || dl.options.length !== lista.length) {
      dl.dataset.cidade = F.cidade;
      dl.replaceChildren(...lista.map((b) => el("option", { value: b.nome, label: `${brl(b.recebe)} para o entregador${b.apelidos.length ? " · também: " + b.apelidos.join(", ") : ""}` })));
    }
    renderResultado();
  }
  function renderResultado() {
    const box = $("#fe-resultado"), reg = $("#fe-registrar");
    if (!F.dados) { reg.hidden = true; return box.replaceChildren(carregandoEl()); }
    const { c, bi, br, dif } = calc();
    if (!c) { reg.hidden = true; return box.replaceChildren(); }
    const lado = (rot, b, txt) => el("div", { class: "fe-lado" + (b ? "" : " vazio") }, el("div", { class: "meta", text: rot }),
      b ? [el("strong", { text: b.nome }), el("div", { class: "meta", text: `Valor ${brl(b.valor)} − taxa do log ${brl(b.taxa_log)}` }),
           el("div", { class: "fe-recebe", text: `${brl(b.recebe)} para o entregador` })]
        : el("div", { class: "meta", text: txt ? "Bairro não encontrado nesta cidade" : "Escolha o bairro" }));
    const iguais = bi && br && bi.id === br.id;
    box.replaceChildren(el("div", { class: "fe-calc" },
      lado("Informado pelo cliente", bi, $("#fe-informado").value.trim()),
      el("div", { class: "fe-seta", "aria-hidden": "true", text: "→" }),
      lado("Onde a entrega terminou", br, $("#fe-real").value.trim())),
      dif == null ? null : el("div", { class: "fe-total" + (dif < 0 ? " negativo" : "") },
        el("span", { text: iguais ? "Os dois bairros são iguais: não há ajuste." : "Ajuste para o entregador" }),
        iguais ? null : el("strong", { text: brl(Math.max(dif, 0)) }),
        dif < 0 ? el("p", { class: "warn-msg", text: `O bairro real paga menos (${brl(dif)}). O ajuste fica zero; isso não deveria acontecer, confira os bairros.` }) : null));
    reg.hidden = !(bi && br) || iguais;
  }

  // ---------- tarifas ----------
  ["#fe-t-q", "#fe-t-inativos"].forEach((s) => $(s).addEventListener("input", () => renderTarifas()));
  $("#fe-t-cidade").addEventListener("change", (e) => { F.tCidade = e.target.value; renderTarifas(); });
  $("#fe-t-novo").addEventListener("click", () => editar(null));
  function renderTarifas() {
    const D = F.dados;
    $("#fe-t-novo").hidden = !D?.pode_editar;
    const t = $("#fe-t-tabela");
    if (!D) return t.replaceChildren(...tabela([["Bairro"]], [], F.erro || "Carregando…"));
    const cids = D.cidades.filter((c) => c.bairros > 0 || D.pode_editar);
    const sel = $("#fe-t-cidade");
    if (sel.options.length !== cids.length) sel.replaceChildren(...cids.map((c) => el("option", { value: c.nome, text: `${c.nome}${c.bairros ? ` (${c.bairros})` : ""}` })));
    if (!F.tCidade || !cids.some((c) => c.nome === F.tCidade)) F.tCidade = (cids.find((c) => c.bairros > 0) || cids[0])?.nome || "";
    sel.value = F.tCidade;
    const q = norm($("#fe-t-q").value);
    const lista = bairrosDa(F.tCidade, $("#fe-t-inativos").checked).filter((b) => !q || norm(b.nome).includes(q) || b.apelidos.some((a) => norm(a).includes(q)));
    t.replaceChildren(...tabela([["Bairro"], ["Valor", 1], ["Taxa do log", 1], ["Entregador recebe", 1], [""]],
      lista.map((b) => el("tr", { style: b.ativo ? null : "opacity:.6" },
        el("td", {}, b.nome + (b.ativo ? "" : " (desativado)"), b.apelidos.length ? el("div", { class: "meta", text: "Também: " + b.apelidos.join(", ") }) : null),
        el("td", { class: "num", text: brl(b.valor) }), el("td", { class: "num", text: brl(b.taxa_log) }),
        el("td", { class: "num" }, el("strong", { text: brl(b.recebe) })),
        el("td", {}, D.pode_editar ? el("button", { class: "btn quiet small", type: "button", onclick: () => editar(b) }, "Editar") : null))),
      F.tCidade ? "Nenhum bairro com esse filtro." : "Nenhuma cidade com bairros cadastrados."));
  }
  function editar(b) {
    const campo = (rot, v, extra = {}) => { const i = el("input", { value: v ?? "", ...extra }); return [el("label", {}, rot, i), i]; };
    const cidade = el("select", {}, ...(F.dados.cidades.map((c) => el("option", { value: c.nome, text: c.nome }))));
    cidade.value = b?.cidade || F.tCidade;
    const [lN, nome] = campo("Nome do bairro", b?.nome, { maxlength: 80 });
    const [lV, valor] = campo("Valor (R$)", b ? String(b.valor).replace(".", ",") : "", { inputmode: "decimal" });
    const [lT, taxa] = campo("Taxa do log (R$)", b ? String(b.taxa_log).replace(".", ",") : "", { inputmode: "decimal" });
    const [lA, apel] = campo("Outros nomes (apelidos), separados por vírgula", b?.apelidos.join(", "));
    const ativo = el("input", { type: "checkbox" }); ativo.checked = b ? b.ativo : true;
    const erroJ = el("p", { class: "warn-msg", role: "alert", hidden: true });
    const n = (x) => (x.value.trim() === "" ? null : Number(x.value.replace(",", ".")));
    const d = janela(b ? "Editar bairro" : "Novo bairro",
      el("label", {}, "Cidade", cidade), lN, el("div", { class: "grid2" }, lV, lT), lA,
      el("label", { class: "check" }, ativo, " Ativo (aparece na calculadora)"), erroJ,
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          e.currentTarget.disabled = true; erroJ.hidden = true;
          try {
            await rpc("salvar_bairro", { p_id: b?.id ?? null, p_cidade: cidade.value, p_nome: nome.value, p_valor: n(valor), p_taxa_log: n(taxa),
              p_apelidos: apel.value.split(",").map((x) => x.trim()).filter(Boolean), p_ativo: ativo.checked });
            d.close(); toast(b ? "Bairro atualizado." : "Bairro criado."); F.tCidade = cidade.value; App.carregar();
          } catch (err) { e.currentTarget.disabled = false; erroJ.textContent = msgErro(err); erroJ.hidden = false; }
        } }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }

  // atalho para os pendentes em tudo o que é de adicional (a tela de pendentes é do Financeiro)
  App.atalhoPendentes = () => {
    const n = S.resumo?.financeiro_pendentes || 0;
    document.querySelectorAll("[data-fin-atalho]").forEach((box) => box.replaceChildren(...(n ? [el("a", { class: "fin-pend", href: "#financeiro/pendentes" },
      el("strong", { text: `${n} ${n === 1 ? "registro seu ainda não foi lançado" : "registros seus ainda não foram lançados"} no sistema` }), " · ver pendentes →")] : [])));
  };

  App.modulo({
    id: "ferramentas", nome: "Ferramentas",
    abas: [
      { id: "calculadora", nome: "Calculadora de bairro", secao: "v-fe-calc" },
      { id: "tarifas", nome: "Tarifas dos bairros", secao: "v-fe-tarifas" },
    ],
    async carregar() {
      try { F.dados = await rpc("tarifas_bairros"); F.erro = null; } catch (e) { F.erro = msgErro(e); throw e; }
    },
    render(aba) { App.atalhoPendentes(); if (aba === "tarifas") renderTarifas(); else renderCalc(); },
  });
})();
