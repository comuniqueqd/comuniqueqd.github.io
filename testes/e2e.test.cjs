// Teste de ponta a ponta: abre o index.html no Chromium contra os emuladores do Firebase.
// O SDK é servido de node_modules (no lugar do gstatic) e o login usa uma credencial do emulador
// no lugar do popup do Google; o resto (adaptador, regras, telas) é o código real.
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(8765, '127.0.0.1');
const SDK = path.join(__dirname, 'node_modules/firebase') + '/';
const G = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CONFIG = `window.FIREBASE_CONFIG={apiKey:"fake-key",authDomain:"demo-teste.firebaseapp.com",projectId:"demo-teste",appId:"1:1:web:1"};window.DONO_EMAIL="dono@exemplo.com";window.FIREBASE_EMULADOR={auth:"http://127.0.0.1:9099",firestore:"127.0.0.1:8080"};`;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok    ' : 'FALHOU ') + msg); if (!cond) fails++; };
(async () => {
  fs.mkdirSync(__dirname + '/prints', { recursive: true });
  const regras = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const rr = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-teste:securityRules', { method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: regras }] } }) });
  if (!rr.ok) throw new Error('não carregou as regras: ' + await rr.text());
  await fetch('http://127.0.0.1:8080/v1/projects/demo-teste/databases/(default)/documents/membros?documentId=membro@x.com', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{"fields":{}}' });
  const b = await chromium.launch();
  async function entrar(email, name, hash = '') {
    const c = await b.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
    await c.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
    await c.route(G + '**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(SDK + r.request().url().split('/').pop()) }));
    const p = await c.newPage();
    p.on('pageerror', e => { console.log('ERRO NA PÁGINA', e.message); fails++; });
    await p.goto('http://127.0.0.1:8765/index.html' + hash);
    await p.waitForSelector('text=Entrar com Google');
    await p.evaluate(async ({ G, email, name }) => {
      const { getApp } = await import(G + 'firebase-app.js'); const A = await import(G + 'firebase-auth.js');
      await A.signInWithCredential(A.getAuth(getApp()), A.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, name, email_verified: true })));
    }, { G, email, name });
    return p;
  }
  // 1. sem acesso
  let p = await entrar('estranho@x.com', 'Estranho');
  await p.waitForSelector('text=ainda não tem acesso', { timeout: 10000 }).catch(() => {});
  ok(await p.isVisible('text=A conta estranho@x.com ainda não tem acesso'), 'conta não liberada vê mensagem de acesso negado');
  ok(await p.isVisible('text=Usar outra conta'), 'mostra "Usar outra conta"');
  await p.screenshot({ path: __dirname + '/prints/s1-negado.png' });
  // 2. membro envia
  p = await entrar('membro@x.com', 'Membro Teste');
  await p.waitForFunction(() => document.querySelector('#who').textContent.includes('Conectado como'), null, { timeout: 15000 });
  ok((await p.textContent('#who')).includes('Membro Teste · envia cadastros'), 'membro conectado com nome e papel: ' + await p.textContent('#who'));
  ok(!(await p.isVisible('a[data-view=pendentes]')), 'membro não vê aba Pendentes');
  ok(await p.isVisible('.titlebar >> text=Sair'), 'botão Sair aparece');
  await p.fill('#f-idapp', 'abc12345'); await p.fill('#f-cpf', '52998224725'); await p.fill('#f-cidade', 'LAGARTO - SE'); await p.fill('#f-obs', 'Teste e2e');
  await p.click('#b-enviar');
  await p.waitForSelector('#ok-msg:not([hidden])', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1000); ok(await p.isVisible('#ok-msg'), 'membro envia cadastro e mensagem continua visível: ' + (await p.textContent('#ok-msg')));
  await p.fill('#f-idapp', 'abc12345'); await p.fill('#f-cidade', 'LAGARTO - SE'); await p.click('#b-enviar');
  ok(await p.isVisible('#dup-msg'), 'aviso de duplicado aparece');
  await p.click('button[type=reset]');
  await p.screenshot({ path: __dirname + '/prints/s2-membro.png' });
  // 3. dono aprova
  const d = await entrar('Dono@Exemplo.com', 'Dona Responsável', '#pendentes');
  await d.waitForSelector('.card', { timeout: 15000 }).catch(() => {});
  ok(await d.isVisible('a[data-view=pendentes]'), 'dono vê aba Pendentes');
  ok((await d.textContent('#queue')).includes('Enviado por Membro Teste'), 'card mostra nome de quem enviou');
  await d.screenshot({ path: __dirname + '/prints/s3-pendentes.png' });
  await d.click('.card >> text=Aprovar');
  await d.waitForSelector('text=Fila zerada', { timeout: 10000 }).catch(() => {});
  ok(await d.isVisible('text=Fila zerada'), 'dono aprova e fila zera');
  await d.goto('http://127.0.0.1:8765/index.html#historico'); await d.waitForSelector('.pill.aprovado', { timeout: 15000 }).catch(() => {});
  ok(await d.isVisible('.pill.aprovado'), 'histórico mostra Aprovado');
  ok((await d.textContent('#t-hist')).includes('por você'), 'histórico mostra quem decidiu');
  const [dl] = await Promise.all([d.waitForEvent('download'), d.click('#b-export')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename().startsWith('cadastros-entregadores-') && csv.includes('abc12345;529.982.247-25;LAGARTO - SE;Teste e2e;Membro Teste'), 'CSV baixado: ' + csv.split('\r\n')[1]);
  await d.screenshot({ path: __dirname + '/prints/s4-historico.png' });
  await d.click('text=Desfazer'); await d.waitForSelector('.pill.pendente', { timeout: 10000 }).catch(() => {});
  ok(await d.isVisible('.pill.pendente'), 'desfazer volta para pendente');
  await d.goto('http://127.0.0.1:8765/index.html#painel'); await d.waitForTimeout(1500);
  await d.screenshot({ path: __dirname + '/prints/s5-painel.png', fullPage: true });
  // 4. membro vê painel atualizado e sai
  await p.goto('http://127.0.0.1:8765/index.html#painel'); await p.waitForTimeout(2000);
  ok((await p.textContent('#tiles')).includes('Pendentes agora1'), 'painel do membro em tempo real');
  await p.click('.titlebar >> text=Sair'); await p.waitForSelector('text=Entrar com Google', { timeout: 10000 }).catch(() => {});
  ok(await p.isVisible('text=Entrar com Google'), 'Sair volta para a tela de login');
  await b.close(); server.close();
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})();
