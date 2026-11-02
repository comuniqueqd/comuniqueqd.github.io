// Configuração do Supabase (projeto Comunique-CadastroDeEntregadores).
// Pegue estes valores em: Supabase → Project Settings → API (ou "Data API").
//   SUPABASE_URL      → "Project URL", algo como https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY → chave "anon" / "public" (ou "publishable"). NUNCA use a "service_role" / "secret".
// A chave anon pode ficar pública: quem protege os dados são as funções e regras do supabase/schema.sql.
// Enquanto os valores começarem com "COLE", a página mostra o aviso de configuração.
window.SUPABASE_URL = "https://nhgmkbfaqonojhaggwui.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_WDjCOhGjVUTtKIHWf5u4wQ_MzN6FHLi";

// ID do cliente OAuth do Google (Google Cloud → Google Auth Platform → Clientes). Também é público.
// Com ele, o login usa o botão oficial do Google, que mostra o endereço do site em vez do Supabase.
window.GOOGLE_CLIENT_ID = "345865016100-449beqo2t5ea0hoo35sto7l8q9i4it8n.apps.googleusercontent.com";
