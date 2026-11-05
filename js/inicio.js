// Tela inicial: um cartão por módulo, com os números da pessoa e os da equipe.
(() => {
  "use strict";
  const App = window.App;
  const { $, el } = App.u;
  const S = App.S;
  const staffAtiv = () => ["moderador", "monitorador"].includes(S.me?.papel);
  const staffBloq = () => ["moderador", "monitorador"].includes(S.me?.papel_bloqueios);

  // número principal + linha "N na equipe" (ou "N seus") embaixo
  const numero = (v, rotulo, extra = null, alerta = false) =>
    el("div", { class: alerta && v ? "alerta" : null }, el("b", { text: v ?? "…" }), el("span", { text: rotulo }),
      extra ? el("span", { class: "equipe", text: extra }) : null);
  const naEquipe = (v) => (v == null ? null : `${v} na equipe`);

  function render() {
    const r = S.resumo;
    $("#ola").textContent = `Olá, ${S.me.nome.split(" ")[0]}!`;
    const cards = [];
    const a = r?.ativacao;
    cards.push(el("a", { class: "modulo-card", href: "#ativacao/" + (staffAtiv() ? "pendentes" : "novo"), id: "card-ativacao" },
      el("h3", { text: "Ativação de entregadores" }),
      el("p", { text: staffAtiv() ? "Análise e aprovação de novos cadastros." : "Envie cadastros e acompanhe a aprovação." }),
      el("div", { class: "numeros" }, staffAtiv()
        ? [numero(a?.equipe_aguardando_analise, "aguardando análise", a ? `${a.meus_aguardando_analise} enviados por você` : null),
           numero(a?.equipe_aguardando_contato, "aguardando novo contato")]
        : [numero(a?.meus_aguardando_analise, "seus aguardando análise", naEquipe(a?.equipe_aguardando_analise)),
           numero(a?.meus_aguardando_contato, "seus aguardando novo contato", naEquipe(a?.equipe_aguardando_contato))])));
    const b = r?.bloqueios;
    if (S.me.papel_bloqueios) {
      cards.push(el("a", { class: "modulo-card bloq", href: "#bloqueios/" + (staffBloq() ? "tratativas" : "novo"), id: "card-bloqueios" },
        el("h3", { text: "Bloqueios" }),
        el("p", { text: staffBloq() ? "Registro de bloqueios, tratativas e reincidência." : "Registre bloqueios e acompanhe as tratativas." }),
        el("div", { class: "numeros" }, staffBloq()
          ? [numero(b?.equipe_bloqueados_agora, "bloqueados agora", b ? `${b.meus_bloqueados_agora} registrados por você` : null),
             numero(b?.tratativas_pendentes, S.me.papel_bloqueios === "moderador" ? "tratativas pendentes" : "tratativas para você", naEquipe(b?.equipe_tratativas_pendentes)),
             b?.tratativas_atrasadas ? numero(b.tratativas_atrasadas, `atrasadas (mais de ${r.prazo_tratativa_horas ?? 32} h)`, null, true) : null,
             b?.atencao ? numero(b.atencao, "entregadores de atenção") : null]
          : [numero(b?.meus_bloqueados_agora, "seus bloqueados agora", naEquipe(b?.equipe_bloqueados_agora)),
             numero(b?.tratativas_pendentes, "suas tratativas em andamento", naEquipe(b?.equipe_tratativas_pendentes)),
             b?.atencao ? numero(b.atencao, "entregadores de atenção") : null])));
    }
    cards.push(el("a", { class: "modulo-card casos", href: "#casos", id: "card-casos" },
      el("h3", { text: "Casos 🕵️" }),
      el("p", { text: "Cadastros suspeitos de uso por terceiros: investigue, comente e dê o veredito." }),
      el("div", { class: "numeros" },
        r?.casos_para_mim ? numero(r.casos_para_mim, "para você verificar", null, true) : null,
        numero(r?.casos_abertos ?? (r ? 0 : null), "casos abertos na equipe"))));
    if (S.me.papel_bloqueios) cards.push(el("a", { class: "modulo-card", href: "#entregadores/cadastrar", id: "card-entregadores", style: "border-top-color:var(--accent)" },
      el("h3", { text: "Entregadores" }),
      el("p", { text: "Cadastre um entregador sem precisar ativar nem bloquear." })));
    const at = r?.atividades;
    cards.push(el("a", { class: "modulo-card ativ", href: "#atividades/pendencias", id: "card-atividades" },
      el("h3", { text: "Atividades" }),
      el("p", { text: "Suas pendências, atividades sugeridas e os avisos para você." }),
      el("div", { class: "numeros" },
        numero(App.modulos.atividades?.totalPendencias?.(), "pendências"),
        numero(at?.para_aceitar, "sugeridas esperando aceite", at ? `${at.equipe_abertas} abertas na equipe` : null),
        numero(S.notif?.nao_lidas, "avisos novos"))));
    cards.push(el("a", { class: "modulo-card", href: "#registros", id: "card-registros", style: "border-top-color:var(--gray)" },
      el("h3", { text: "Registros" }),
      el("p", { text: "Tudo o que a equipe fez nos módulos, em ordem: quem, o quê e quando." })));
    $("#modulos-grid").replaceChildren(...cards);
    // faixa da versão nova: os destaques e o botão para rever a janela "O que há de novo"
    const nv = App.novidades;
    $("#inicio-novidades").replaceChildren(nv ? el("div", { class: "faixa-novidades" },
      el("b", { text: `Novidades: ${nv.NOVIDADES.tema}` }),
      el("span", { text: nv.NOVIDADES.itens.map(([t]) => t).join(" · ") }),
      el("button", { class: "btn small", type: "button", onclick: () => nv.mostrar() }, "Ver o que há de novo")) : "");
  }

  App.modulo({
    id: "inicio", nome: "Início",
    abas: [{ id: "inicio", nome: "Início", secao: "v-inicio" }],
    render,
  });
})();
