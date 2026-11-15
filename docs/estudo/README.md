# Estudo (organização do usuário com o Claude, não faz parte do app)

- `mapa-estudo.html`: o mapa de estudo e o curso (link privado https://claude.ai/artifact/9vvEPJfZMa3FUfmaDJhr7U). Não editar à mão: rodar `python3 docs/estudo/montar.py` e publicar no mesmo link.
- `curso.json` (versão 2): `modulos[]` = {id, titulo, meta, projeto_ponte, aulas: [[id, título, pronta]]} na ordem de estudo (ids não seguem a ordem: m1a7 vem antes de m1a5); `aulas[id]` = {objetivo, tempo_min, antes, explicacao[], exemplo, como_o_computador_le[], pratica[{tipo, enunciado, resposta}], dicas[3], erros_comuns[], revisao[{pergunta, resposta, de}], checagem[], comunique}. Aulas antigas no formato v1 (exercicio/resposta) ainda são mostradas.
- `metodologia.md`: o método (PRIMM, exemplo resolvido, revisão espaçada 1/3/7/21 dias, domínio, dica antes de resposta), com as fontes. Vira a seção "Como o curso funciona".
- `mapa-conteudo.json`: áreas, trilhas do básico e conceitos do mapa.

Como o curso foi feito (15/11/2026): pedagogo (pesquisa e plano de 61 aulas) → dois escritores em paralelo → revisor do contra (rodou todo o código no Chromium e corrigiu ~30 pontos). Prontas: módulos 0 e 1 (11 aulas).

Próximos módulos: mesmo processo, um módulo por vez (escritor(es) + revisor do contra), quando o usuário pedir. A ordem é a do plano: m2 JavaScript, m5 Git e publicar, m3 SQL, m4 Supabase, m6 testes, m7 design, m8 análise, m9 segurança, m10 processo, m11 projeto. Cada aula nova usa o mesmo formato e as perguntas de revisão só de aulas anteriores.
