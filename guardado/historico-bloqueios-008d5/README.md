# Histórico de bloqueios: visual da 008d5 (guardado)

Na 008d6 o Histórico de bloqueios mudou bastante a pedido do usuário. A versão de antes ficou guardada aqui, porque talvez a gente volte para ela.

**Como era (008d5):**
- Colunas: Situação · Entregador (nome e ID) · Infração · Punição (com a ocorrência embaixo) · Início (com quem registrou embaixo) · Cidade · Tratativa (resumida) · ações.
- Linha aberta: uma linha de texto corrido (fim do bloqueio, observação, motivo da liberação, origem), a tratativa completa em destaque e a lista de eventos.

**Como ficou (008d6):** colunas agrupadas (Entregador com ID e cidade; Infração e punição; Registro com data e quem registrou) e a linha aberta em três blocos com título: Dados do registro, Tratativa e O que aconteceu (data na frente).

**Arquivos:**
- `historico-antigo.js`: as funções `tratativaCurta()`, `renderHist()` e `detalheHist()` como eram em `js/bloqueios.js`.
- O CSS da época está em `estilo.css` (blocos "008d4"; os blocos "008d6" foram acrescentados depois e podem ser apagados ao voltar).

**Para voltar:** trocar `renderHist()` e `detalheHist()` em `js/bloqueios.js` pelas daqui (a `tratativaCurta()` continua a mesma), apagar o bloco de CSS "008d6", ajustar o e2e (os testes procuram `.trat-curta` e `.trat-completa`, que existem nas duas versões) e trocar a versão (`?v=`, `versao.txt`, `VERSAO_APP`). O código completo da 008d5 também está no commit `d2befc6`.
