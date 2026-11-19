# Funções com a versão atual escrita (A7-01)

Algumas funções do banco foram alteradas por "remendo": uma migração lia a função com `pg_get_functiondef`,
trocava um trecho do texto e recriava. Funcionava, mas o corpo inteiro da versão em uso não estava escrito em
nenhum arquivo. Se fosse preciso reinstalar ou revisar, ninguém sabia ao certo o que estava rodando.

Cada arquivo aqui tem a versão atual de uma dessas funções (depois de todas as migrações), tirada do banco de teste
com todas as migrações carregadas (`testes/carregar-banco.mjs`).

Regras daqui para frente:
- Mudar uma destas funções: nova migração com o corpo inteiro (`create or replace`) e atualizar o arquivo daqui.
- Nada de remendo novo por troca de texto.
- O `npm run test:casa` falha se algum arquivo daqui ficar diferente do banco.
