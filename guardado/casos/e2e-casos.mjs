// Trecho do testes/e2e.test.mjs retirado em 11/2026 (casos guardados). Para religar, cole de volta
// antes da seção "18. 008b · avisos" e religue o interruptor no banco de teste (parametros_casos.ligado).

  // 17. migração 008 · "espionagem profissional": casos suspeitos
  await ir(m7, "#casos"); await m7.reload();
  const cartaoCaso = "#casos-lista .card.caso:has-text('outro1234')";
  ok(await esperar(m7, cartaoCaso), "tela Casos mostra o caso da tentativa com CPF repetido");
  ok((await texto(m7, cartaoCaso)).includes("CPF repetido com outro nome ou ID") && (await texto(m7, cartaoCaso)).includes("Cadastro que já existia"), "o caso traz o tipo e o cadastro que já existia");
  ok(await m7.isVisible("nav.grupo [data-espelho=c-casos]:not([hidden])"), "contador de casos na barra de Entregadores");
  ok(await m7.isVisible("#c-grupo-entregadores:not([hidden])"), "o item Entregadores do menu mostra o que espera pela pessoa");
  await m7.click(`${cartaoCaso} >> text=Eu verifico`);
  ok(await esperar(m7, "#casos-lista .grupo:has-text('Para você verificar') .card:has-text('outro1234')"), "Eu verifico: o caso vai para 'Para você verificar'");
  await ir(m7, "#atividades/pendencias");
  ok(await esperar(m7, "#at-lista >> text=1 caso(s) suspeito(s) para você verificar"), "nas Pendências aparece o caso para verificar");
  await ir(m7, "#casos"); await esperar(m7, cartaoCaso);
  await m7.check(`${cartaoCaso} label.marcar:has-text('Liguei para o entregador') input`);
  ok(await esperar(m7, `${cartaoCaso} label.marcar:has-text('Liguei para o entregador') >> text=Monitor Um`), "checklist marcado, com quem e quando");
  await m7.fill(`${cartaoCaso} textarea[aria-label='Comentário no caso']`, "Falei com o entregador: é a mesma pessoa, trocou de conta");
  await m7.click(`${cartaoCaso} >> text=Comentar`);
  ok(await esperar(m7, `${cartaoCaso} >> text=trocou de conta`), "comentário no caso");
  await m7.screenshot({ path: path.join(PRINTS, "g2-casos.png"), fullPage: true });
  await m7.click(`${cartaoCaso} >> text=Descartar: estava tudo certo`);
  ok(await esperar(m7, "#toast:has-text('Escreva o que foi verificado')"), "veredito pede a nota");
  await m7.fill(`${cartaoCaso} textarea[aria-label='Nota do veredito']`, "Mesma pessoa, conta nova");
  await m7.click(`${cartaoCaso} >> text=Descartar: estava tudo certo`);
  ok(await esperar(m7, "#toast:has-text('Caso descartado')"), "monitorador descarta o caso");
  await m7.click("[data-casos=encerrados]");
  ok(await esperar(m7, `${cartaoCaso} >> text=Veredito de Monitor Um`), "o caso vai para Encerrados com o veredito");
  // o suporte vê o caso e não tem botão de veredito
  await ir(n7, "#casos"); await n7.reload();
  await n7.click("[data-casos=encerrados]");
  ok(await esperar(n7, cartaoCaso) && !(await n7.isVisible(`${cartaoCaso} >> text=Confirmar: era terceiro`)), "suporte vê os casos, sem veredito");
  // lupa do detetive e placar
  await m7.fill("#q-topo", "outro1234");
  ok(await esperar(m7, "#busca-res:not([hidden]) >> text=Casos 🕵️"), "lupa do detetive acha o caso pelo ID digitado na tentativa");
  await m7.keyboard.press("Escape");
  await ir(m7, "#analises/placar");
  ok(await esperar(m7, "#t-placar >> text=Monitor Um"), "placar do detetive mostra quem verificou");
  await m7.screenshot({ path: path.join(PRINTS, "g3-placar.png"), fullPage: true });
  ok(!(await texto(m7, "main")).includes("null") && !(await texto(n7, "main")).includes("undefined"), "telas da 008 sem textos vazios");

