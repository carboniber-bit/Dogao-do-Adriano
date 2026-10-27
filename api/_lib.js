// Utilidades compartilhadas (arquivos com "_" no nome não viram funções na Vercel)
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // chave secreta: só no servidor
const AK = process.env.SUPABASE_ANON_KEY || "";         // chave publishable

const temDB = () => Boolean(URL_ && SK);
const temAuth = () => Boolean(URL_ && AK);

// Chaves novas (sb_...) vão só em "apikey"; chaves antigas (JWT) vão também em Authorization.
const chaveHeaders = (k) => (k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` });

async function db(path, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { ...chaveHeaders(SK), "Content-Type": "application/json", Prefer: prefer || "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { /* ignore */ }
  if (!r.ok) { const e = new Error(`db ${r.status} ${txt.slice(0, 300)}`); e.status = r.status; throw e; }
  return data;
}

// Confere o token de login com o Supabase Auth. Devolve {id, email} ou null.
const cacheTokens = new Map();
async function usuario(req) {
  const h = String(req.headers.authorization || "");
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || !temAuth()) return null;
  const c = cacheTokens.get(token);
  if (c && c.ate > Date.now()) return c.user;
  try {
    const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: AK, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id) return null;
    const user = { id: u.id, email: String(u.email || "").toLowerCase() };
    cacheTokens.set(token, { user, ate: Date.now() + 30_000 });
    if (cacheTokens.size > 500) cacheTokens.clear();
    return user;
  } catch { return null; }
}

async function perfilDe(user) {
  const rows = await db(`perfis?id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (rows && rows[0]) return rows[0];
  const novo = await db("perfis", { method: "POST", prefer: "return=representation,resolution=merge-duplicates", body: { id: user.id, email: user.email } });
  return novo[0];
}

// Barra a requisição se quem chamou não é administrador. Devolve {user, perfil} ou null (resposta já enviada).
async function exigirAdmin(req, res) {
  if (!temDB()) { res.status(503).json({ erro: "Banco de dados não configurado." }); return null; }
  const user = await usuario(req);
  if (!user) { res.status(401).json({ erro: "Faça login." }); return null; }
  const perfil = await perfilDe(user);
  if (!perfil || perfil.role !== "admin") { res.status(403).json({ erro: "Acesso restrito aos administradores." }); return null; }
  return { user, perfil };
}

const limpa = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const arred = (n) => Math.round(n * 100) / 100;
const ehUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
const ehId = (s) => /^[a-z0-9_-]{1,40}$/i.test(String(s));
const enc = encodeURIComponent;

async function auditar(quem, acao, detalhes) {
  try { await db("auditoria", { method: "POST", prefer: "return=minimal", body: { quem, acao, detalhes } }); } catch (e) { console.error("auditoria:", e.message); }
}

function corpo(req) {
  let b = req.body;
  try { if (typeof b === "string") b = JSON.parse(b); } catch { b = null; }
  return b && typeof b === "object" ? b : {};
}

module.exports = { URL_, AK, temDB, temAuth, db, usuario, perfilDe, exigirAdmin, limpa, arred, ehUuid, ehId, enc, auditar, corpo };
