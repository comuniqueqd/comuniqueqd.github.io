// Configuração do Firebase.
// Pegue estes valores em: Console do Firebase → Configurações do projeto → Seus apps → App da Web.
// Eles NÃO são secretos e podem ficar públicos: quem protege os dados são as regras em firestore.rules.
// Enquanto apiKey começar com "COLE", a página roda sem banco (mostra "Sem conexão com o banco").
window.FIREBASE_CONFIG = {
  apiKey: "COLE_AQUI",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  appId: "COLE_AQUI",
};

// E-mail da conta Google que aprova os cadastros. Tem que ser igual ao de firestore.rules.
window.DONO_EMAIL = "";
