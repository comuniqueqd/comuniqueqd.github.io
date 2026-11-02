# Comunique

No ar em https://comuniqueqd.github.io/

Sistema da equipe de operação, com três módulos:

- **Ativação de entregadores**: o suporte envia cadastros e moderadores/monitoradores aprovam, reprovam ou encerram.
- **Bloqueios**: registro de bloqueios com cálculo automático da punição (reincidência, progressão, encerramento de parceria), tratativas por cidade, painel e histórico.
- **Atividades**: as pendências de cada pessoa nos dois módulos e os avisos recebidos.

Banco de dados: PostgreSQL no Supabase ([`supabase/`](supabase/)), com login Google. Passo a passo: [SUPABASE.md](SUPABASE.md). Consultas de análise: [`supabase/analises.sql`](supabase/analises.sql).
