# Como este curso funciona

Mateus, este curso foi feito para quem começa do zero e estuda depois do trabalho. Ele usa o Comunique, o app que você já usa e ajudou a criar, como exemplo do começo ao fim. A meta é você entender o próprio app, conseguir mexer nele e, no fim, construir um "mini-Comunique" (um registro de ocorrências) e colocar no ar.

## Por que assim

A cabeça só segura poucas coisas novas ao mesmo tempo. Quando chega informação demais, nada fica. Por isso cada aula traz uma ideia só, em passos pequenos (Sweller, 1988).

Para quem começa, ver um exemplo pronto e bem explicado ensina mais do que tentar sozinho de cara. Depois, aos poucos, o exemplo vai ficando incompleto e você completa cada vez mais (Renkl e Atkinson, 2004).

Ler código vem antes de escrever. Primeiro você adivinha o que o código faz, depois roda e confere, depois mexe nele, e só no fim cria o seu. Esse caminho tem nome: PRIMM (Sentance e Waite, 2017).

Lembrar de cabeça fixa mais do que reler. Responder uma pergunta sem olhar, mesmo errando, vale mais do que ler a resposta de novo. E revisar espaçado (hoje, daqui a uns dias, daqui a semanas) fixa mais do que estudar tudo de uma vez (Dunlosky e outros, 2013; Cepeda e outros, 2008).

Adulto aprende melhor quando resolve um problema real dele (Knowles, 1984). Por isso os exemplos vêm do seu trabalho: entregador, cidade, bloqueio, tarefa.

## Quanto tempo

- Uma sessão = uma aula = 15 a 30 minutos.
- Ideal: 3 a 5 sessões por semana. Melhor 20 minutos em 4 dias do que 80 minutos num dia só.
- No celular dá para ler, prever e revisar. Para rodar e criar código, use o computador.

## O ciclo de cada aula

1. **Revisão (3 min).** Três perguntas de aulas anteriores. Responda de cabeça, só depois confira.
2. **Objetivo (1 min).** O que você vai conseguir fazer no fim.
3. **Explicação (5 min).** Passos curtos, uma ideia por vez.
4. **Exemplo resolvido (5 min).** Código comentado, com o que o computador faz em cada linha.
5. **Prática (10 a 15 min),** do mais guiado ao mais livre:
   - *Prever:* leia o código e diga o que vai acontecer, antes de rodar.
   - *Rodar:* rode e compare com o que você previu.
   - *Investigar:* responda perguntas sobre linhas específicas.
   - *Ordenar:* as linhas estão embaralhadas; coloque na ordem certa.
   - *Modificar:* mude o código para fazer outra coisa parecida.
   - *Criar:* faça um pequeno código novo.
6. **Erros comuns (2 min).** O que costuma dar errado e como perceber.
7. **Checagem (2 min).** Frases "Consigo ...". Marque só o que você fez sem olhar.
8. **No Comunique.** Onde aquilo aparece no app de verdade.

Ao fim de cada módulo há um **projeto-ponte**: um pedacinho do mini-Comunique. Juntando os pedaços, o projeto final fica quase pronto.

## Agenda de revisão

Depois de terminar uma aula, revise nestes dias:

| Quando | O que fazer | Tempo |
|---|---|---|
| 1 dia depois | Responder as perguntas de revisão da aula, sem olhar | 3 min |
| 3 dias depois | Refazer a prática "criar" do zero | 5 min |
| 7 dias depois | Perguntas de revisão de novo | 3 min |
| 21 dias depois | Explicar a aula em voz alta, em 1 minuto, como para um colega | 2 min |

As próprias aulas já trazem perguntas das anteriores. Pergunta errada volta para "1 dia depois".

Misturar assuntos também ajuda. Nas revisões, as perguntas de HTML, JavaScript e SQL vêm misturadas de propósito. Parece mais difícil no começo, mas fixa mais (Rohrer e Taylor, 2007).

## Como saber se aprendeu

Uma aula está **dominada** quando:

1. você marcou todas as frases "Consigo ..." da checagem sem olhar a aula;
2. fez a prática "criar" sozinho, funcionando, sem copiar;
3. acertou pelo menos 4 de 5 perguntas de revisão dela nos dias seguintes.

Se faltou algo, não tem problema. Antes de seguir, refaça a prática com uma pequena variação e tente de novo na próxima sessão. Ir em frente sem a base costuma travar duas aulas depois (Bloom, 1968).

## Quando travar

Siga esta ordem. Pare quando destravar.

1. **Leia a mensagem de erro inteira.** Procure o número da linha e a palavra principal.
2. **Volte um passo.** Desfaça a última mudança. Funcionou de novo? O problema está nela.
3. **Mostre o valor.** Use `console.log(...)` para ver o que a variável tem de verdade.
4. **Explique em voz alta, linha por linha,** o que você acha que o computador faz. Muitas vezes o erro aparece no meio da frase.
5. **Peça uma dica ao Claude** (veja abaixo).
6. **Pare 10 minutos.** Descanso resolve mais do que parece. Anote onde parou.

## Como usar o Claude como tutor sem colar

Pesquisas mostram que a IA ajuda iniciantes a fazer mais coisas, mas quem pede a solução inteira pode aprender menos para os exercícios seguintes (Kazemitabaar e outros, 2023 e 2024). A regra é: **dica antes de resposta**.

Escreva assim:

> Estou na aula m2a3 do meu curso. Tentei isto: (cole o código). Esperava que acontecesse X, mas aconteceu Y. Não me dê a resposta. Me dê só uma dica pequena.

Depois:

- Se a dica não bastar, peça **uma dica maior**.
- Só peça a resposta depois de duas dicas. Ao receber, **explique a resposta com suas palavras** e refaça sem olhar no dia seguinte.
- Peça também: "me faça 3 perguntas para ver se eu entendi".
- Nunca cole senha, chave secreta ou dado de entregador real numa conversa.

## Fontes

- Sweller, J. (1988). Cognitive load during problem solving. *Cognitive Science*.
- Renkl, A.; Atkinson, R. (2004). How fading worked solution steps works. *Instructional Science*.
- Margulieux, L.; Morrison, B.; Decker, A. (2020). Reducing withdrawal and failure rates in introductory programming with subgoal labeled worked examples. *IJ STEM Education*.
- Sentance, S.; Waite, J. (2017). PRIMM: exploring pedagogical approaches for teaching text-based programming. WiPSCE.
- Ericson, B.; Margulieux, L.; Rick, J. (2017). Solving Parsons problems versus fixing and writing code. Koli Calling.
- Dunlosky, J. e outros (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*.
- Cepeda, N. e outros (2008). Spacing effects in learning: a temporal ridgeline of optimal retention. *Psychological Science*.
- Rohrer, D.; Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*.
- du Boulay, B. (1986). Some difficulties of learning to program; Sorva, J. (2013). Notional machines and introductory programming education. *ACM TOCE*.
- Bloom, B. (1968). Learning for mastery; Guskey, T. (2010). Lessons of mastery learning. ASCD.
- Knowles, M. (1984). *The Adult Learner*.
- Anderson, L.; Krathwohl, D. (2001). *A Taxonomy for Learning, Teaching, and Assessing*.
- Kazemitabaar, M. e outros (2023). Studying the effect of AI code generators on supporting novice learners. CHI.
