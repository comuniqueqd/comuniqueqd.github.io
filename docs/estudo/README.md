# Estudo (organização do usuário com o Claude, não faz parte do app)

- `mapa-estudo.html`: o mapa de estudo e o curso (publicado no link privado https://claude.ai/artifact/9vvEPJfZMa3FUfmaDJhr7U). Ao mudar o conteúdo, regerar a página e publicar no mesmo link.
- `mapa-conteudo.json`: áreas, trilhas do básico e conceitos do mapa ([id, nome, descrição, trilha[], conceitos[nome, o que é, no Comunique, para ir além, código]]).
- `curso.json`: módulos e aulas. `aulas[id]` = {objetivo, explicacao[], exemplo, exercicio, resposta, comunique}; em `modulos[].aulas`, o terceiro valor diz se a aula está pronta.

Ritmo combinado (15/11/2026): o curso é completo, mas escrito **aos poucos**. Quando o usuário pedir "próxima aula", escrever 1 ou 2 aulas em ordem, sem agentes, aproveitando as dúvidas dele, marcar como prontas e republicar.
