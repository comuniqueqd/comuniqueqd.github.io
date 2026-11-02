// Tela inicial: um cartão por módulo, com os números que pedem atenção.
(() => {
  "use strict";
  const App = window.App;
  const { $, el } = App.u;
  const S = App.S;
  const staffAtiv = () => ["moderador", "monitorador"].includes(S.me?.papel);
  const staffBloq = () => ["moderador", "monitorador"].includes(S.me?.papel_bloqueios);

  const numero = (v, rotulo) => el("div", {}, el("b", { text: v ?? "…" }), el("span", { text: rotulo }));
  function render() {
    const r = S.resumo;
    $("#ola").textContent = `Olá, ${S.me.nome.split(" ")[0]}!`;
    const cards = [];
    const a = r?.ativacao;
    cards.push(el("a", { class: "modulo-card", href: "#ativacao/" + (staffAtiv() ? "pendentes" : "novo"), id: "card-ativacao" },
      el("h3", { text: "Ativação de entregadores" }),
      el("p", { text: staffAtiv() ? "Análise e aprovação de novos cadastros." : "Envie cadastros e acompanhe a aprovação." }),
      el("div", { class: "numeros" },
        numero(a?.aguardando_analise, staffAtiv() ? "aguardando análise" : "seus aguardando análise"),
        numero(a?.aguardando_contato, "aguardando novo contato"))));
    const b = r?.bloqueios;
    if (S.me.papel_bloqueios) {
      cards.push(el("a", { class: "modulo-card bloq", href: "#bloqueios/" + (staffBloq() ? "tratativas" : "novo"), id: "card-bloqueios" },
        el("h3", { text: "Bloqueios" }),
        el("p", { text: staffBloq() ? "Registro de bloqueios, tratativas e reincidência." : "Registre bloqueios e acompanhe as tratativas." }),
        el("div", { class: "numeros" },
          numero(b?.bloqueados_agora, staffBloq() ? "bloqueados agora" : "seus bloqueados agora"),
          numero(b?.tratativas_pendentes, staffBloq() ? "tratativas para você" : "suas tratativas em andamento"))));
    }
    cards.push(el("a", { class: "modulo-card ativ", href: "#atividades/pendencias", id: "card-atividades" },
      el("h3", { text: "Atividades" }),
      el("p", { text: "Suas pendências dos dois módulos e os avisos para você." }),
      el("div", { class: "numeros" },
        numero(App.modulos.atividades?.totalPendencias?.(), "pendências"),
        numero(S.notif?.nao_lidas, "avisos novos"))));
    $("#modulos-grid").replaceChildren(...cards);
  }

  App.modulo({
    id: "inicio", nome: "Início",
    abas: [{ id: "inicio", nome: "Início", secao: "v-inicio" }],
    render,
  });
})();
