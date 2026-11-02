// Equipe (só moderadores da ativação): autorizar acesso, pedidos e acesso de cada pessoa por módulo.
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

  App.modulo({
    id: "equipe", nome: "Equipe",
    acesso: () => S.me?.papel === "moderador",
    abas: [{ id: "equipe", nome: "Equipe", secao: "v-equipe" }],
    render: renderEquipe,
  });
})();
