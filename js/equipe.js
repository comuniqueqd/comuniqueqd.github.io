// Equipe: autorizar acesso e pedidos (só moderadores da ativação) e Regras de equipe (todos veem; moderadores editam):
// cidades, gestão, operadores logísticos, tarifas e quem é responsável por cada cidade.
(() => {
  "use strict";
  const App = window.App;
  const { $, el, duracao, toast, PAPEL, rpc, msgErro } = App.u;
  const S = App.S;
  const render = () => App.render();
  const carregar = () => App.carregar();
  const OPC_ATIV = Object.entries(PAPEL);
  const OPC_BLOQ = [["", "Sem acesso"], ...OPC_ATIV];
  const nomeBloq = (p) => (p ? PAPEL[p] : "sem acesso");
  const selPapel = (opcoes, valor, rotulo, aoMudar) => {
    const s = el("select", { "aria-label": rotulo, onchange: aoMudar }, ...opcoes.map(([v, t]) => el("option", { value: v, text: t })));
    s.value = valor ?? "";
    return s;
  };

  function renderEquipe() {
    const eq = S.equipe;
    const ped = eq?.pedidos || [];
    $("#pedidos-box").hidden = !ped.length;
    $("#t-pedidos").replaceChildren(
      el("thead", {}, el("tr", {}, ["E-mail", "Nome", "Pediu há", "Ativação", "Bloqueios", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, ped.map((p) => {
        const sa = selPapel([...OPC_ATIV].reverse(), "suporte", "Acesso na ativação para " + p.email);
        const sb = selPapel(OPC_BLOQ, "", "Acesso nos bloqueios para " + p.email);
        const nome = el("input", { "aria-label": "Nome", maxlength: "80", value: p.nome || "" });
        return el("tr", {}, el("td", { text: p.email }), el("td", {}, nome), el("td", { text: duracao(p.pedido_em).txt }), el("td", {}, sa), el("td", {}, sb),
          el("td", { style: "white-space:nowrap" },
            el("button", { class: "btn approve small", type: "button", onclick: (e) => salvarMembro(p.email, nome.value || p.email, sa.value, sb.value, e.currentTarget, "Acesso liberado.") }, "Liberar"),
            el("button", { class: "btn link", type: "button", onclick: (e) => recusar(p.email, e.currentTarget) }, "Recusar")));
      })));
    const t = $("#t-equipe");
    const head = el("thead", {}, el("tr", {}, ["Nome", "E-mail", "Ativação", "Bloqueios", "Situação", ""].map((h) => el("th", { text: h }))));
    if (!eq) return t.replaceChildren(head, el("tbody", {}, el("tr", {}, el("td", { colspan: "6", class: "meta", text: "Carregando…" }))));
    t.replaceChildren(head, el("tbody", {}, eq.membros.map((m) => {
      let pa, pb;
      if (m.admin_final) {
        pa = el("span", { text: "Moderador · administrador final 🔒", title: "Este acesso não pode ser removido nem alterado." });
        pb = el("span", { text: "Moderador 🔒" });
      } else {
        pa = selPapel(OPC_ATIV, m.papel, "Acesso de " + m.nome + " na ativação",
          (e) => salvarMembro(m.email, m.nome, e.target.value, m.papel_bloqueios, e.target, `Ativação: ${m.nome} agora é ${PAPEL[e.target.value]}.`));
        pb = selPapel(OPC_BLOQ, m.papel_bloqueios, "Acesso de " + m.nome + " nos bloqueios",
          (e) => salvarMembro(m.email, m.nome, m.papel, e.target.value, e.target, `Bloqueios: ${m.nome} agora tem ${nomeBloq(e.target.value)}.`));
      }
      const acoes = el("td", { style: "white-space:nowrap" });
      if (!m.admin_final && m.email !== S.me.email) {
        if (S.confirmar["m" + m.email]) acoes.append(el("button", { class: "btn danger small", type: "button", onclick: (e) => remover(m, e.currentTarget) }, "Confirmar remoção"), el("button", { class: "btn link", type: "button", onclick: () => { delete S.confirmar["m" + m.email]; render(); } }, "Cancelar"));
        else acoes.append(el("button", { class: "btn quiet", type: "button", onclick: () => { S.confirmar["m" + m.email] = true; render(); } }, "Remover"));
      }
      return el("tr", {}, el("td", { text: m.email === S.me.email ? `${m.nome} (você)` : m.nome }), el("td", { text: m.email }), el("td", {}, pa), el("td", {}, pb),
        el("td", { class: "meta", text: m.ja_entrou ? "Já entrou" : "Ainda não entrou" }), acoes);
    })));
  }
  async function salvarMembro(email, nome, papel, papelBloq, ctrl, ok) {
    if (ctrl) ctrl.disabled = true;
    try { await rpc("salvar_membro", { p_email: email, p_nome: nome, p_papel: papel, p_papel_bloqueios: papelBloq || null }); toast(ok); await carregar(); }
    catch (e) { toast(msgErro(e)); await carregar(); }
    finally { if (ctrl) ctrl.disabled = false; }
  }
  async function recusar(email, btn) {
    btn.disabled = true;
    try { await rpc("recusar_pedido", { p_email: email }); toast("Pedido recusado."); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  async function remover(m, btn) {
    btn.disabled = true;
    try { await rpc("remover_membro", { p_email: m.email }); delete S.confirmar["m" + m.email]; toast(`${m.nome} não tem mais acesso.`); await carregar(); }
    catch (e) { btn.disabled = false; toast(msgErro(e)); }
  }
  $("#f-membro").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("#m-email").value.trim().toLowerCase(), nome = $("#m-nome").value.trim(), papel = $("#m-papel").value, papelBloq = $("#m-papel-bloq").value;
    $("#m-erro").textContent = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "Digite um e-mail válido." : !nome ? "Digite o nome." : "";
    if ($("#m-erro").textContent) return;
    await salvarMembro(email, nome, papel, papelBloq, ev.submitter, `${nome} pode entrar: ativação como ${PAPEL[papel]}, bloqueios: ${nomeBloq(papelBloq)}.`);
    $("#f-membro").reset();
  });

  // ---------- regras de equipe (todos veem; moderadores editam) ----------
  const R = { dados: null, erro: null };
  const GESTAO = { quero: "Quero Delivery", operador: "Operador Logístico" };
  const brl = (v) => (v == null ? "—" : "R$ " + Number(v).toFixed(2).replace(".", ","));
  const contato = (tel) => (tel ? el("div", { class: "contato", text: tel }) : null);
  const opcMembros = (atual, vazio) => [el("option", { value: "", text: vazio }),
    ...(R.dados?.membros || []).map((m) => el("option", { value: m.email, text: m.nome + (["moderador", "monitorador"].includes(m.papel_bloqueios) ? "" : " (não recebe tratativas)") }))];
  async function salvar(fn, args, btn, msg, d) {
    if (btn) btn.disabled = true;
    try { await rpc(fn, args); d?.close(); toast(msg); R.dados = await rpc("regras_equipe"); App.render(); }
    catch (e) { if (btn) btn.disabled = false; toast(msgErro(e)); }
  }
  function editarCidade(c) {
    const nova = !c;
    c = c || { nome: "", gestao: "quero", ativa: true };
    const nome = el("input", { maxlength: "80", placeholder: "CIDADE - UF", disabled: !nova }); nome.value = c.nome;
    const gestao = el("select", {}, ...Object.entries(GESTAO).map(([v, t]) => el("option", { value: v, text: t }))); gestao.value = c.gestao;
    const operador = el("select", {}, el("option", { value: "", text: "Escolha o operador" }), ...R.dados.operadores.filter((o) => o.ativo || o.id === c.operador_id).map((o) => el("option", { value: o.id, text: o.nome })));
    operador.value = c.operador_id ?? "";
    const resp = el("select", {}, ...opcMembros(c.responsavel_email, "Ninguém (vai para os moderadores)")); resp.value = c.responsavel_email || "";
    const tarifa = el("input", { type: "number", min: "0", step: "0.01" }); tarifa.value = c.tarifa_inicial ?? "";
    const tipo = el("select", {}, el("option", { value: "", text: "—" }), el("option", { value: "km", text: "Por km" }), el("option", { value: "bairro", text: "Por bairro" })); tipo.value = c.tarifa_tipo || "";
    const adic = el("input", { type: "number", min: "0", step: "0.01" }); adic.value = c.adicional_km ?? "";
    const ativa = el("input", { type: "checkbox" }); ativa.checked = c.ativa;
    const ro = R.dados.responsavel_operadores;
    const lOp = el("label", {}, "Operador logístico", operador), lResp = el("label", {}, "Responsável pela cidade", resp), lAdic = el("label", {}, "Adicional por km (R$)", adic);
    const nota = el("p", { class: "meta", style: "margin:0" });
    const ajustar = () => {
      const op = gestao.value === "operador";
      lOp.hidden = !op; lResp.hidden = op; lAdic.hidden = tipo.value !== "km";
      nota.textContent = op ? `Cidade de operador logístico: os avisos vão para o responsável pelos operadores (${ro?.nome || "ninguém escolhido ainda"}).` : "";
    };
    gestao.addEventListener("change", ajustar); tipo.addEventListener("change", ajustar); ajustar();
    const d = App.u.janela(nova ? "Nova cidade" : `Editar ${c.nome}`,
      el("div", { class: "grid2" }, el("label", {}, "Cidade", nome), el("label", {}, "Gestão", gestao)),
      el("div", { class: "grid2" }, lOp, lResp), nota,
      el("div", { class: "grid2" }, el("label", {}, "Tarifa inicial (R$)", tarifa), el("label", {}, "Tarifa por", tipo)), lAdic,
      el("label", { class: "marcar" }, ativa, el("span", { text: "Cidade ativa (aparece nas listas de cidades)" })),
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => salvar("salvar_cidade_equipe", {
          p_nome: nome.value, p_gestao: gestao.value, p_responsavel_email: gestao.value === "quero" ? resp.value || null : c.responsavel_email || null,
          p_operador_id: gestao.value === "operador" && operador.value ? Number(operador.value) : null,
          p_tarifa_inicial: tarifa.value === "" ? null : Number(tarifa.value), p_tarifa_tipo: tipo.value || null,
          p_adicional_km: adic.value === "" ? null : Number(adic.value), p_ativa: ativa.checked }, e.currentTarget, nova ? "Cidade adicionada." : `${nome.value} atualizada.`, d) }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  function editarOperador(o) {
    o = o || { id: null, nome: "", contato: "", ativo: true };
    const nome = el("input", { maxlength: "80" }); nome.value = o.nome;
    const tel = el("input", { maxlength: "40", placeholder: "(79) 9 9999-9999" }); tel.value = o.contato || "";
    const ativo = el("input", { type: "checkbox" }); ativo.checked = o.ativo;
    const d = App.u.janela(o.id ? `Editar operador ${o.nome}` : "Novo operador logístico",
      el("div", { class: "grid2" }, el("label", {}, "Nome", nome), el("label", {}, "Contato", tel)),
      el("label", { class: "marcar" }, ativo, el("span", { text: "Ativo" })),
      el("div", { class: "actions" },
        el("button", { class: "btn primary", type: "button", onclick: (e) => salvar("salvar_operador", { p_id: o.id, p_nome: nome.value, p_contato: tel.value, p_ativo: ativo.checked }, e.currentTarget, "Operador salvo.", d) }, "Salvar"),
        el("button", { class: "btn link", type: "button", onclick: () => d.close() }, "Cancelar")));
  }
  // aba Operadores logísticos: quem responde por eles e a lista com os contatos
  function renderOperadores() {
    const D = R.dados, pode = !!D?.pode_editar;
    $("#eq-novo-operador").hidden = !pode;
    if (!D) { $("#eq-resp-op").replaceChildren(); return $("#eq-t-operadores").replaceChildren(...App.u.tabela([["Operador"]], [], R.erro || "Carregando…")); }
    const ro = D.responsavel_operadores;
    const sel = pode ? el("select", { "aria-label": "Responsável pelos operadores logísticos", onchange: (e) => salvar("salvar_responsavel_operadores", { p_email: e.target.value || null }, e.target, "Responsável pelos operadores atualizado.") }, ...opcMembros(ro?.email, "Ninguém (vai para os moderadores)")) : null;
    if (sel) sel.value = ro?.email || "";
    $("#eq-resp-op").replaceChildren(...[el("h3", { text: "Responsável pelos operadores logísticos" }),
      el("p", { class: "sub", text: "Recebe os avisos de todas as cidades de operador logístico." }),
      pode ? sel : el("p", {}, el("b", { text: ro?.nome || "Ninguém escolhido (vai para os moderadores)" })),
      ro && !ro.recebe_tratativas ? el("p", { class: "alerta-revisar bloco", text: `${ro.nome} não é monitorador nos bloqueios: as tratativas dessas cidades vão para os moderadores (os outros avisos chegam normalmente).` }) : null].filter(Boolean));
    // 008d5: as cidades de cada operador aparecem ao lado do nome
    $("#eq-t-operadores").replaceChildren(...App.u.tabela([["Operador"], ["Cidades"], ["Contato"], [""]],
      D.operadores.map((o) => {
        const cids = D.cidades.filter((c) => c.operador_id === o.id).map((c) => c.nome).sort((x, y) => x.localeCompare(y, "pt-BR"));
        return el("tr", { style: o.ativo ? null : "opacity:.6" }, el("td", { text: o.nome + (o.ativo ? "" : " (inativo)") }),
        el("td", { class: "op-cidades" }, cids.length ? el("div", { class: "chips" }, cids.map((n) => el("span", { class: "chip", text: n }))) : el("span", { class: "meta", text: "Nenhuma cidade" })),
        el("td", { text: o.contato || "—" }),
        el("td", {}, pode ? el("button", { class: "btn quiet small", type: "button", onclick: () => editarOperador(o) }, "Editar") : null));
      }), "Nenhum operador cadastrado."));
  }
  // aba Regras de equipe: só as cidades (as de operador mostram o operador e o contato dele)
  function renderRegras() {
    const D = R.dados, pode = !!D?.pode_editar;
    $("#eq-nova-cidade").hidden = !pode;
    if (!D) return $("#eq-t-cidades").replaceChildren(...App.u.tabela([["Cidade"]], [], R.erro || "Carregando…"));
    // cidades
    const q = App.u.norm($("#eq-q").value), g = $("#eq-gestao").value, inativas = $("#eq-inativas").checked;
    const lista = D.cidades.filter((c) => (inativas || c.ativa) && (!g || c.gestao === g) && (!q || App.u.norm([c.nome, c.operador_nome, c.responsavel_nome].join(" ")).includes(q)));
    $("#eq-t-cidades").replaceChildren(...App.u.tabela(
      [["Cidade"], ["Gestão"], ["Operador logístico"], ["Responsável"], ["Tarifa inicial", 1], ["Tarifa por"], ["Adicional por km", 1], [""]],
      lista.map((c) => el("tr", { style: c.ativa ? null : "opacity:.6" },
        el("td", {}, c.nome, c.ativa ? null : el("div", { class: "meta", text: "desativada" })),
        el("td", {}, el("span", { class: "gestao " + c.gestao, text: GESTAO[c.gestao] })),
        el("td", {}, c.gestao === "operador" ? [c.operador_nome || "—", contato(c.operador_contato)] : "—"),
        el("td", {}, c.responsavel_nome || el("span", { class: "meta", text: "Moderadores" }),
          c.responsavel_nome && !c.recebe_tratativas ? el("div", { class: "alerta-revisar", text: "tratativas vão para os moderadores" }) : null),
        el("td", { class: "num", text: brl(c.tarifa_inicial) }),
        el("td", { text: c.tarifa_tipo === "km" ? "km" : c.tarifa_tipo === "bairro" ? "bairro" : "—" }),
        el("td", { class: "num", text: c.tarifa_tipo === "km" ? brl(c.adicional_km) : "—" }),
        el("td", {}, pode ? el("button", { class: "btn quiet small", type: "button", onclick: () => editarCidade(c) }, "Editar") : null))),
      "Nenhuma cidade com esse filtro."));
  }
  $("#eq-nova-cidade").addEventListener("click", () => editarCidade(null));
  $("#eq-novo-operador").addEventListener("click", () => editarOperador(null));
  ["#eq-q", "#eq-gestao", "#eq-inativas"].forEach((x) => $(x).addEventListener("input", () => renderRegras()));

  App.modulo({
    id: "equipe", nome: "Equipe",
    abas: [
      { id: "equipe", nome: "Equipe", secao: "v-equipe", pode: () => S.me?.papel === "moderador" },
      { id: "regras", nome: "Regras de equipe", secao: "v-eq-regras" },
      { id: "operadores", nome: "Operadores logísticos", secao: "v-eq-operadores" },
    ],
    padrao: () => (S.me?.papel === "moderador" ? "equipe" : "regras"),
    async carregar(aba) {
      if (aba === "regras" || aba === "operadores") { try { R.dados = await rpc("regras_equipe"); R.erro = null; } catch (e) { R.erro = msgErro(e); throw e; } }
    },
    render: (aba) => (aba === "regras" ? renderRegras() : aba === "operadores" ? renderOperadores() : renderEquipe()),
  });
})();
