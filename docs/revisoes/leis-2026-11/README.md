# Leis de tecnologia e dados que tocam o Comunique (leitura de 17/11/2026)

Organização interna do usuário com o Claude; não faz parte do app. **Leitura técnica, não é parecer jurídico.**
Fonte: o acervo em Markdown github.com/ctresb/leis (textos convertidos de fontes oficiais; conferir sempre a fonte indicada no cabeçalho de cada arquivo antes de citar). Lidos no texto compilado (vigente) quando o acervo tinha.

## Se aplica ao Comunique

| Lei | O que pede | Situação no Comunique |
|---|---|---|
| **LGPD, Lei 13.709/2018** | Princípios de finalidade, necessidade e segurança (art. 6º); base legal (art. 7º, provável legítimo interesse ou execução de contrato com o entregador). | O controlador é a empresa; o Comunique é ferramenta interna. A 009s tirou o CPF (necessidade). |
| LGPD art. 15 e 16 | O tratamento termina quando a finalidade é alcançada; os dados são eliminados, salvo obrigação legal, estudo, ou uso exclusivo do controlador anonimizado. | **Falta** retenção e "esquecer entregador" (mapa: S4). |
| LGPD art. 18 | Direitos do titular: confirmação, acesso, correção, eliminação, informação sobre compartilhamento. | Sem canal nem rotina para responder (mapa: L2, A6-S1). |
| LGPD art. 20 | Revisão de decisão tomada só por tratamento automatizado e explicação dos critérios (§ 1º). | As horas da restrição são calculadas pelas regras. **Falta** o caminho de revisão registrado (mapa: **L1**). A explicação das regras já existe (`infracoes.explicacao`). |
| LGPD art. 37 | Registro das operações de tratamento. | **Falta** (mapa: L2). |
| LGPD art. 41 | Encarregado com contato público. | A página de privacidade não indica (mapa: L4, S5). |
| LGPD art. 46 | Segurança desde a concepção (§ 2º). | RLS, funções definer, sem CPF; pendências S1, S2, S3 no mapa. |
| LGPD art. 48 | Comunicar incidente à autoridade e aos titulares, com o conteúdo mínimo do § 1º. | **Falta** plano (mapa: L3). |
| LGPD art. 52 | Sanções: advertência, multa de até 2% do faturamento (teto R$ 50 milhões por infração), publicização, bloqueio e eliminação dos dados. | Contexto do risco. |
| **Lei 15.352/2026** | Transforma a ANPD em **Agência** Nacional de Proteção de Dados. | Atualizar o nome na privacidade (L4). |
| **Lei 9.610/1998 (direitos autorais)** | O autor é a pessoa física criadora da obra. | Desenhos feitos com IA: autoria e licença a definir antes de usar o kit fora da equipe (revisão da identidade, v9 seção 4). |
| **Lei 9.609/1998 (software)** | Proteção do programa de computador. | O repositório é público: decidir a licença do código (hoje sem arquivo LICENSE). |
| **Lei 12.737/2012** | Crime de invasão de dispositivo informático. | Ajuda a empresa em caso de acesso indevido; reforça o registro de quem acessou (A6-S1). |
| **Lei 14.063/2020** | Assinatura eletrônica (simples, avançada, qualificada). | Se um dia o app registrar aceite de acordo ou termo, a assinatura simples (login) vale para atos de menor risco. |

## Não se aplica hoje (anotado para não reler)

- **Marco Civil, Lei 12.965/2014, art. 15** (guarda de registros de acesso por 6 meses): vale para provedor de aplicação oferecido ao público com fins econômicos; o Comunique é ferramenta interna da equipe. Rever se um dia entregadores ou parceiros entrarem no app.
- **Lei 14.297/2022** (proteção ao entregador de aplicativo): vale só durante a emergência de saúde da covid-19, já encerrada.
- **Estatuto Digital da Criança e do Adolescente, Lei 15.211/2025**: o app não é dirigido a crianças.
- **Lei 15.134/2025** (muda a LGPD): trata de proteção a juízes, promotores e defensores.
- As resoluções da ANPD presentes no acervo são internas da agência. As que importariam (incidentes, encarregado, agentes de pequeno porte, dosimetria) não estão no acervo; conferir no site da ANPD quando formos implementar L1 a L4.

## Itens novos no mapa do projeto (https://claude.ai/artifact/4H91HMVXzXXka9FiSwmKRf)

L1 revisão da restrição (alta) · L2 registro das operações · L3 plano de incidente · L4 encarregado e nome da ANPD na privacidade. S4 (retenção) ganhou a base legal (arts. 15 e 16).
