-- =====================================================================
-- 009c2: três opções para cada mensagem de engajamento, versão "para a
-- cidade" do movimento alto (quando não há nome do entregador) e o aviso
-- dos anexos (PDF + áudio) na mensagem de entrega ativa para o parceiro.
--
-- modelos_mensagem ganha `tipo` (o que a mensagem é) e `opcao` (1, 2, 3).
-- A chave continua única: a opção 1 mantém a chave antiga.
-- Textos já editados no app não são trocados (só os que ninguém mexeu).
-- Pode rodar mais de uma vez. Rodar depois da 009c.
-- =====================================================================

alter table public.modelos_mensagem add column if not exists tipo text;
alter table public.modelos_mensagem add column if not exists opcao smallint not null default 1 check (opcao between 1 and 9);
update public.modelos_mensagem set tipo = chave where tipo is null;
alter table public.modelos_mensagem alter column tipo set not null;

-- o grupo novo: mensagens para a cidade inteira (sem nome)
alter table public.modelos_mensagem drop constraint if exists modelos_mensagem_grupo_check;
alter table public.modelos_mensagem add constraint modelos_mensagem_grupo_check check (grupo in ('bloqueio', 'entregador', 'cidade', 'parceiro'));

-- parceiro: avisa dos anexos (só se ninguém editou o texto)
update public.modelos_mensagem set texto = $t$Olá, {estabelecimento}! Tudo bem?

Aqui é {meu_nome}, da equipe Quero Log. Passando para avisar que a entrega pelo Quero Log está ativa para vocês em {cidade}. Seus pedidos já podem ser entregues pelos nossos entregadores parceiros.

Junto com esta mensagem, envio um PDF com o passo a passo de como usar e um áudio explicando os detalhes do funcionamento.

Qualquer dúvida sobre o funcionamento, prazos ou valores, é só falar comigo por aqui. Boas vendas! 🚀$t$, titulo = 'Parceiro: entrega pelo Quero Log ativa (com PDF e áudio)'
 where chave = 'parceiro_ativacao' and atualizado_por is null and texto not like '%PDF%';

update public.modelos_mensagem set titulo = 'Engajamento: movimento alto' where chave = 'engajamento_movimento' and atualizado_por is null;

insert into public.modelos_mensagem (chave, tipo, opcao, grupo, titulo, texto, ordem) values
  ('engajamento_movimento_2', 'engajamento_movimento', 2, 'entregador', 'Engajamento: movimento alto',
   $t${nome}, tudo certo? O movimento em {cidade} está acelerado agora e os pedidos estão saindo rápido. Se puder, fica online que tem corrida te esperando! 🚀$t$, 10),
  ('engajamento_movimento_3', 'engajamento_movimento', 3, 'entregador', 'Engajamento: movimento alto',
   $t$Oi, {nome}! Passando para avisar que {cidade} está com muitos pedidos neste momento. É uma boa hora para rodar. Bora? 🛵$t$, 10),
  ('engajamento_cidade', 'engajamento_cidade', 1, 'cidade', 'Engajamento: movimento alto (para a cidade)',
   $t$Atenção, entregadores de {cidade}! O movimento está forte agora e tem pedido esperando entregador. Quem puder, fica online! 🛵$t$, 13),
  ('engajamento_cidade_2', 'engajamento_cidade', 2, 'cidade', 'Engajamento: movimento alto (para a cidade)',
   $t$Pessoal de {cidade}, os pedidos estão chegando com tudo neste momento. Boa hora para rodar: fiquem online! 🚀$t$, 13),
  ('engajamento_cidade_3', 'engajamento_cidade', 3, 'cidade', 'Engajamento: movimento alto (para a cidade)',
   $t$Alô, {cidade}! Estamos com alta demanda de pedidos agora. Se você está disponível, fica online e aproveita o movimento! 💪$t$, 13),
  ('engajamento_reconhecimento_2', 'engajamento_reconhecimento', 2, 'entregador', 'Engajamento: reconhecimento',
   $t$Oi, {nome}! Queremos reconhecer o seu trabalho em {cidade}: entregas no prazo e bom atendimento fazem toda a diferença. Obrigado por fazer parte do time! 🙌$t$, 11),
  ('engajamento_reconhecimento_3', 'engajamento_reconhecimento', 3, 'entregador', 'Engajamento: reconhecimento',
   $t${nome}, obrigado pelo empenho nas entregas desta semana! Os clientes e as lojas de {cidade} agradecem. Conte com a gente! 💪$t$, 11),
  ('engajamento_voltar_2', 'engajamento_voltar', 2, 'entregador', 'Engajamento: voltar a rodar',
   $t${nome}, faz um tempinho que você não roda com a gente em {cidade}. Está tudo bem? Se precisar de alguma ajuda para voltar, é só chamar. 🙂$t$, 12),
  ('engajamento_voltar_3', 'engajamento_voltar', 3, 'entregador', 'Engajamento: voltar a rodar',
   $t$Oi, {nome}! O movimento em {cidade} está bom e adoraríamos ter você de volta nas entregas. Quando quiser, é só ficar online!$t$, 12)
on conflict (chave) do nothing;

-- a lista de modelos passa a dizer o tipo e a opção
create or replace function public.mensagens()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_papel('moderador', 'monitorador', 'suporte');
  return jsonb_build_object(
    'pode_editar', public.sou_moderador(),
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('chave', m.chave, 'tipo', m.tipo, 'opcao', m.opcao, 'grupo', m.grupo,
        'titulo', m.titulo, 'texto', m.texto, 'atualizado_em', m.atualizado_em, 'atualizado_por', m.atualizado_por)
        order by m.ordem, m.tipo, m.opcao) from public.modelos_mensagem m), '[]'),
    'infracoes', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.nome, 'leve', i.leve, 'ativa', i.ativa,
        'explicacao', i.explicacao, 'agravante', i.agravante, 'agravante_efeito', i.agravante_efeito) order by i.leve, i.ordem)
      from public.infracoes i), '[]'),
    'leves', (select jsonb_build_object('limite', leves_limite, 'janela_dias', leves_janela_dias) from public.parametros_bloqueio where id));
end $$;

revoke all on function public.mensagens() from public, anon;
grant execute on function public.mensagens() to authenticated;
notify pgrst, 'reload schema';
