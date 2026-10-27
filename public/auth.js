/* Login compartilhado entre o site e o painel /admin (Supabase Auth via REST, sem bibliotecas).
   A sessão fica no localStorage deste navegador. Quem manda de verdade é o servidor:
   ele confere o token e o papel (cliente/admin) em toda chamada. */
(function () {
  const K = "dogao_auth";
  let cfg;
  const ler = () => { try { return JSON.parse(localStorage.getItem(K)); } catch { return null; } };
  const gravar = (s) => { try { s ? localStorage.setItem(K, JSON.stringify(s)) : localStorage.removeItem(K); } catch {} };

  async function config() {
    if (cfg !== undefined) return cfg;
    try { const r = await fetch("/api/status", { cache: "no-store" }); cfg = (await r.json()).auth || null; } catch { cfg = null; }
    return cfg;
  }
  const traduz = (j, status) => {
    const m = String((j && (j.msg || j.message || j.error_description || j.error)) || "");
    const c = String((j && (j.error_code || j.code)) || "");
    if (/invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if (/not confirmed/i.test(m) || c === "email_not_confirmed") return "Confirme seu e-mail pelo link que enviamos e entre de novo.";
    if (/already registered|already been registered/i.test(m) || c === "user_already_exists") return "Este e-mail já tem conta. Use Entrar.";
    if (/rate limit/i.test(m) || c === "over_email_send_rate_limit" || status === 429) return "Muitas tentativas. Aguarde alguns minutos.";
    if (/password/i.test(m) && /(6|8|short|weak|characters)/i.test(m)) return "Senha muito fraca. Use pelo menos 8 caracteres.";
    if (/valid email|invalid.*email/i.test(m)) return "E-mail inválido.";
    return "Não foi possível concluir. Tente de novo.";
  };
  async function chamar(caminho, opts, tokenUsuario) {
    const c = await config();
    if (!c) throw new Error("Login indisponível no momento.");
    const h = { apikey: c.key, "Content-Type": "application/json" };
    if (tokenUsuario) h.Authorization = "Bearer " + tokenUsuario;
    const r = await fetch(c.url + "/auth/v1" + caminho, { ...opts, headers: h });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(traduz(j, r.status));
    return j;
  }
  const sessaoDe = (j) => ({ access_token: j.access_token, refresh_token: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: j.user && j.user.email });

  async function token() {
    const s = ler(); if (!s) return null;
    if (s.exp - Date.now() > 60_000) return s.access_token;
    try {
      const j = await chamar("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) });
      const n = sessaoDe(j); gravar(n); return n.access_token;
    } catch { gravar(null); return null; }
  }
  async function fetchAuth(url, opts = {}) {
    const t = await token();
    const h = { ...(opts.headers || {}) };
    if (t) h.Authorization = "Bearer " + t;
    const r = await fetch(url, { ...opts, headers: h });
    if (r.status === 401 && t) gravar(null);
    return r;
  }

  window.auth = {
    config,
    logado: () => Boolean(ler()),
    email: () => (ler() || {}).email || "",
    token,
    fetch: fetchAuth,
    async entrar(email, senha) {
      const j = await chamar("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password: senha }) });
      gravar(sessaoDe(j));
    },
    async cadastrar(nome, email, senha) {
      const j = await chamar("/signup", { method: "POST", body: JSON.stringify({ email, password: senha, data: { nome } }) });
      if (j.access_token) { gravar(sessaoDe(j)); return { logado: true }; }
      return { logado: false }; // projeto exige confirmação de e-mail
    },
    async recuperar(email) { await chamar("/recover", { method: "POST", body: JSON.stringify({ email }) }); },
    async novaSenha(senha) { const t = await token(); if (!t) throw new Error("Link expirado. Peça um novo."); await chamar("/user", { method: "PUT", body: JSON.stringify({ password: senha }) }, t); },
    sair() { gravar(null); },
    // Ao voltar do link de "esqueci a senha", o Supabase põe a sessão no #hash da URL.
    lerHash() {
      const h = new URLSearchParams(location.hash.replace(/^#/, ""));
      if (!h.get("access_token")) return null;
      gravar({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), exp: Date.now() + (Number(h.get("expires_in")) || 3600) * 1000, email: "" });
      history.replaceState(null, "", location.pathname + location.search);
      return h.get("type");
    },
  };
})();
