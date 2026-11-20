-- 009y1 (NF-1, 20/11/2026): mensagem pronta para o entregador depois de aprovar ou reprovar um cadastro.
-- Dois modelos novos no grupo "entregador" (editáveis pelos moderadores em Ferramentas → Mensagens, como os outros):
-- {nome} = primeiro nome, {cidade}, {motivo} = motivo da reprovação, {reenviar} = o que o entregador precisa mandar de
-- novo (o front escreve a partir do motivo; "Outro" usa o detalhe digitado). Só insere se ainda não existir (não
-- sobrescreve texto editado). Pode rodar de novo.

insert into public.modelos_mensagem (chave, grupo, tipo, opcao, titulo, texto, ordem)
values
  ('ativacao_aprovado', 'entregador', 'ativacao_aprovado', 1, 'Cadastro aprovado',
   'Olá, {nome}! Seu cadastro como entregador foi aprovado. A partir de agora você já pode ficar online no aplicativo e receber pedidos em {cidade}. Qualquer dúvida, fale com a gente por aqui. Boas entregas!', 5),
  ('ativacao_reprovado', 'entregador', 'ativacao_reprovado', 1, 'Cadastro com pendência',
   'Olá, {nome}! Analisamos o seu cadastro e falta um ajuste para aprovar: {motivo}. {reenviar} Assim que você mandar, a gente analisa de novo. Obrigado!', 6)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
