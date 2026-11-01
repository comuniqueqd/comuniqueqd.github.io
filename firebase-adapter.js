// Adaptador Firebase.
// O index.html foi escrito para o runtime de artefatos do claude.ai, que oferece
// window.claude.use("db" | "user" | "downloads"). Fora do claude.ai (GitHub Pages, localhost),
// este arquivo cria um window.claude equivalente usando Firebase Auth (login Google) + Firestore.
// Dentro do claude.ai o window.claude já existe e este arquivo não faz nada.
(() => {
  "use strict";
  if (window.claude) return;
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || /^COLE/.test(cfg.apiKey)) return; // ainda não configurado: a página mostra "Sem conexão"
  const DONO = String(window.DONO_EMAIL || "").trim().toLowerCase();
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

  // Converte os códigos de erro do Firebase para os que o index.html já trata.
  const CODES = { "permission-denied": "invalid_argument", "resource-exhausted": "quota_exceeded", "unauthenticated": "revoked" };
  const wrapErr = (e) => Object.assign(new Error(e?.message || String(e)), { code: CODES[e?.code] || e?.code, original: e });
  const wrap = (p) => p.catch((e) => { throw wrapErr(e); });

  let boot = null;
  function start() {
    boot ??= (async () => {
      const [{ initializeApp }, A, F] = await Promise.all([
        import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js"),
      ]);
      const app = initializeApp(cfg);
      const auth = A.getAuth(app), fs = F.getFirestore(app);
      const emu = window.FIREBASE_EMULADOR; // só para testes locais
      if (emu) { A.connectAuthEmulator(auth, emu.auth, { disableWarnings: true }); const [h, p] = emu.firestore.split(":"); F.connectFirestoreEmulator(fs, h, Number(p)); }

      const user = await gate(A, auth, F, fs);
      const email = user.email.toLowerCase();
      try { await F.setDoc(F.doc(fs, "perfis", user.uid), { nome: user.displayName || email, email }); } catch (_) {}
      botaoSair(() => A.signOut(auth));

      const coll = (name) => {
        const ref = F.collection(fs, name);
        return {
          onSnapshot: (next, error) => F.onSnapshot(ref, { includeMetadataChanges: true },
            (snap) => next({ metadata: { fromCache: snap.metadata.fromCache }, docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })) }),
            (e) => error && error(wrapErr(e))),
          add: (data) => wrap(F.addDoc(ref, data)),
          doc: (id) => { const r = F.doc(fs, name, id); return { set: (d) => wrap(F.setDoc(r, d)), delete: () => wrap(F.deleteDoc(r)) }; },
        };
      };
      return {
        db: { collection: coll },
        user: {
          isOwner: () => !!DONO && email === DONO,
          id: async () => user.uid,
          can: () => true, // só membros passam do login; as regras do Firestore garantem o resto
          profiles: async (ids) => {
            const out = {};
            await Promise.all(ids.map(async (id) => {
              try { const s = await F.getDoc(F.doc(fs, "perfis", id)); if (s.exists()) out[id] = { name: s.data().nome }; } catch (_) {}
            }));
            return out;
          },
        },
      };
    })();
    return boot;
  }

  const downloads = {
    save: async ({ filename, data }) => {
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };

  window.claude = {
    use: async (k) => {
      if (k === "downloads") return downloads;
      if (k === "db" || k === "user") return (await start())[k];
      return null;
    },
  };

  // ---------- tela de login ----------
  // Resolve quando entra uma conta que é o dono ou está em membros/{email}.
  function gate(A, auth, F, fs) {
    const ui = telaLogin();
    ui.entrar.onclick = async () => {
      ui.erro("");
      try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); }
      catch (e) { if (!/popup-closed|cancelled-popup/.test(e?.code || "")) ui.erro("Não foi possível entrar (" + (e?.code || e) + ")."); }
    };
    ui.trocar.onclick = () => A.signOut(auth);
    return new Promise((resolve) => {
      let ok = false;
      A.onAuthStateChanged(auth, async (u) => {
        if (ok) { if (!u) location.reload(); return; } // saiu depois de entrar
        if (!u) return ui.mostrar("entrar");
        ui.mostrar("verificando");
        const email = (u.email || "").toLowerCase();
        let membro = !!DONO && email === DONO;
        if (!membro) { try { membro = (await F.getDoc(F.doc(fs, "membros", email))).exists(); } catch (_) {} }
        if (!membro) return ui.mostrar("negado", email);
        ok = true; ui.fechar(); resolve(u);
      });
    });
  }

  function telaLogin() {
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Entrar");
    box.style.cssText = "position:fixed;inset:0;z-index:20;background:var(--bg);display:grid;place-items:center;padding:16px";
    box.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:24px;max-width:420px;width:100%;display:grid;gap:14px">
        <h2 style="margin:0">Cadastro de Entregadores</h2>
        <p class="sub" style="margin:0" data-txt></p>
        <p class="err" data-erro></p>
        <div class="actions">
          <button class="btn primary" type="button" data-entrar>Entrar com Google</button>
          <button class="btn" type="button" data-trocar hidden>Usar outra conta</button>
        </div>
      </div>`;
    document.body.append(box);
    const q = (s) => box.querySelector(s);
    const ui = {
      entrar: q("[data-entrar]"), trocar: q("[data-trocar]"),
      erro: (m) => (q("[data-erro]").textContent = m),
      mostrar(estado, email) {
        const txt = {
          entrar: "Entre com sua conta Google para ver e enviar cadastros.",
          verificando: "Verificando acesso…",
          negado: `A conta ${email} ainda não tem acesso. Peça ao responsável para liberar este e-mail.`,
        }[estado];
        q("[data-txt]").textContent = txt;
        ui.entrar.hidden = estado !== "entrar";
        ui.trocar.hidden = estado !== "negado";
      },
      fechar: () => box.remove(),
    };
    ui.mostrar("verificando");
    return ui;
  }

  function botaoSair(sair) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn link", textContent: "Sair" });
    b.onclick = sair;
    document.querySelector(".titlebar")?.append(b);
  }
})();
