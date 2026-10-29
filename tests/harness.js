// Ambiente de teste sem rede: Supabase (PostgREST + Auth) e Mercado Pago/Telegram simulados dentro do processo.
// Intercepta o fetch global; as funções de api/ rodam de verdade.
const crypto = require("crypto");
const path = require("path");

const SB = "http://fake.supabase.test";
Object.assign(process.env, {
  SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_teste", SUPABASE_ANON_KEY: "sb_publishable_teste",
  MP_ACCESS_TOKEN: "APP_USR-token-secreto-de-teste", SITE_URL: "https://dogao.test",
  TELEGRAM_BOT_TOKEN: "bot-teste", TELEGRAM_CHAT_ID: "123", IGNORAR_HORARIO: "1",
});
delete process.env.MP_WEBHOOK_SECRET;

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const uuid = () => crypto.randomUUID();

/* ---------- estado ---------- */
const est = {};
function reiniciar() {
  est.tabelas = {
    categorias: [{ id: "dogs", nome: "Dogões", ordem: 1 }, { id: "adicionais", nome: "Adicionais", ordem: 2 }, { id: "bebidas", nome: "Bebidas", ordem: 3 }],
    itens: [
      { id: "tradicional", categoria: "dogs", nome: "Dogão Tradicional", descricao: "", preco: 18, paes: ["Banha", "Sal"], encomenda: null, ativo: true, verificar: false, ordem: 1 },
      { id: "agua", categoria: "bebidas", nome: "Água", descricao: "", preco: 5, paes: null, encomenda: null, ativo: true, verificar: false, ordem: 2 },
      { id: "sumido", categoria: "bebidas", nome: "Item desativado", descricao: "", preco: 9, paes: null, encomenda: null, ativo: false, verificar: false, ordem: 3 },
      { id: "bacon", categoria: "adicionais", nome: "Bacon", descricao: "", preco: 6, paes: null, encomenda: null, ativo: true, verificar: false, ordem: 5 },
      { id: "pure", categoria: "adicionais", nome: "Purê", descricao: "", preco: 6, paes: null, encomenda: null, ativo: true, verificar: false, ordem: 6 },
      { id: "queijo", categoria: "adicionais", nome: "Queijo ralado", descricao: "", preco: 2, paes: null, encomenda: null, ativo: true, verificar: false, ordem: 7 },
      { id: "esgotado", categoria: "adicionais", nome: "Ovo", descricao: "", preco: 3, paes: null, encomenda: null, ativo: false, verificar: false, ordem: 8 },
      { id: "festa", categoria: "dogs", nome: "Cento de salgados", descricao: "", preco: 120, paes: null, encomenda: "Sob encomenda", ativo: true, verificar: false, ordem: 4 },
    ],
    config: [{ chave: "taxa_entrega", valor: 6 }],
    perfis: [
      { id: "u-cliente", email: "cliente@teste.com", nome: "Cliente Logado", telefone: "11999990000", endereco: "Rua A, 1", role: "cliente", criado_em: new Date().toISOString() },
      { id: "u-admin", email: "admin@teste.com", nome: "Admin", telefone: "", endereco: "", role: "admin", criado_em: new Date().toISOString() },
    ],
    pedidos: [], auditoria: [],
  };
  est.tokens = { "tok-cliente": { id: "u-cliente", email: "cliente@teste.com" }, "tok-admin": { id: "u-admin", email: "admin@teste.com" } };
  est.mp = { pagamentos: new Map(), proximoId: 9000, falhar: null, chamadasCriar: [], chamadasConsulta: 0, consultaFalha: false };
  est.telegram = [];
  est.dbFalhaPedidos = false;
}
reiniciar();

/* ---------- PostgREST simulado ---------- */
function parseValor(v) {
  if (v === "true") return true; if (v === "false") return false; if (v === "null") return null;
  return v;
}
function casa(linha, col, expr) {
  const v = linha[col];
  const [op, ...resto] = expr.split("."); const arg = resto.join(".");
  const igual = (a, b) => String(a) === String(b);
  if (op === "eq") return igual(v, parseValor(arg));
  if (op === "neq") return !igual(v, parseValor(arg));
  if (op === "in") return arg.replace(/^\(|\)$/g, "").split(",").some((x) => igual(v, x));
  if (op === "gte") return String(v) >= arg;
  if (op === "lt") return String(v) < arg;
  return true;
}
async function postgrest(url, init) {
  const u = new URL(url); const tabela = u.pathname.replace("/rest/v1/", "");
  const rows = est.tabelas[tabela]; if (!rows) return resp(404, { message: "tabela inexistente" });
  const metodo = init.method || "GET"; const prefer = (init.headers && init.headers.Prefer) || "";
  const filtros = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
  const filtrar = () => rows.filter((l) => filtros.every(([k, e]) => casa(l, k, e)));
  const corpo = init.body ? JSON.parse(init.body) : null;
  const min = prefer.includes("return=minimal");
  if (metodo === "GET") {
    let r = filtrar().map((x) => ({ ...x }));
    const ord = u.searchParams.get("order");
    if (ord) { const [c, d] = ord.split("."); r.sort((a, b) => (a[c] > b[c] ? 1 : -1) * (d === "desc" ? -1 : 1)); }
    return resp(200, r);
  }
  if (metodo === "POST") {
    if (tabela === "pedidos" && est.dbFalhaPedidos) return resp(500, { message: "falha simulada" });
    const novo = { id: uuid(), criado_em: new Date().toISOString(), mp_payment_id: null, mp_metodo: null, pago_em: null, ...corpo };
    if (tabela === "perfis") { const ex = rows.find((x) => x.id === corpo.id); if (ex) return resp(201, [ex]); novo.role = "cliente"; novo.nome = novo.nome || ""; }
    if (tabela === "config") { const ex = rows.find((x) => x.chave === corpo.chave); if (ex) { Object.assign(ex, corpo); return min ? resp(204) : resp(201, [ex]); } }
    if (tabela === "pedidos" && rows.some((x) => x.ref === novo.ref)) return resp(409, { message: "duplicado" });
    rows.push(novo); return min ? resp(204) : resp(201, [{ ...novo }]);
  }
  if (metodo === "PATCH") {
    const alvo = filtrar(); alvo.forEach((l) => Object.assign(l, corpo));
    return min ? resp(204) : resp(200, alvo.map((x) => ({ ...x })));
  }
  return resp(405, {});
}
const resp = (status, corpo) => ({ ok: status < 400, status, text: async () => (corpo === undefined ? "" : JSON.stringify(corpo)), json: async () => corpo });

/* ---------- Mercado Pago / Telegram simulados ---------- */
async function mercadoPago(url, init) {
  const u = new URL(url); const metodo = init.method || "GET";
  const auth = (init.headers || {}).Authorization;
  if (auth !== `Bearer ${process.env.MP_ACCESS_TOKEN}`) return resp(401, { message: "invalid token" });
  if (metodo === "POST" && u.pathname === "/v1/payments") {
    const h = init.headers; const b = JSON.parse(init.body);
    est.mp.chamadasCriar.push({ headers: h, body: b });
    if (est.mp.falhar) return resp(est.mp.falhar.status, est.mp.falhar.corpo);
    const id = est.mp.proximoId++;
    const pg = { id, status: "pending", payment_method_id: b.payment_method_id, payment_type_id: "bank_transfer", external_reference: b.external_reference, metadata: b.metadata,
      transaction_amount: b.transaction_amount, date_of_expiration: b.date_of_expiration,
      point_of_interaction: { transaction_data: { qr_code: `00020126580014br.gov.bcb.pix0136teste-${id}5204000053039865802BR`, qr_code_base64: PNG_1x1, ticket_url: `https://mp.test/ticket/${id}` } } };
    est.mp.pagamentos.set(String(id), pg); return resp(201, pg);
  }
  const m = u.pathname.match(/^\/v1\/payments\/(.+)$/);
  if (metodo === "GET" && m) {
    est.mp.chamadasConsulta++;
    if (est.mp.consultaFalha) return resp(500, { message: "fora do ar" });
    const pg = est.mp.pagamentos.get(m[1]); return pg ? resp(200, pg) : resp(404, { message: "not found" });
  }
  if (metodo === "POST" && u.pathname === "/checkout/preferences") {
    const b = JSON.parse(init.body); est.mp.ultimaPreferencia = b;
    return resp(201, { id: "pref-1", init_point: "https://mp.test/checkout/pref-1" });
  }
  return resp(404, { message: "rota MP desconhecida " + u.pathname });
}
function aprovar(id, extra = {}) { Object.assign(est.mp.pagamentos.get(String(id)), { status: "approved" }, extra); }
function definirStatus(id, status) { est.mp.pagamentos.get(String(id)).status = status; }

const fetchReal = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith(SB + "/rest/v1/")) return postgrest(u, init);
  if (u.startsWith(SB + "/auth/v1/user")) {
    const t = String((init.headers || {}).Authorization || "").replace("Bearer ", "");
    return est.tokens[t] ? resp(200, est.tokens[t]) : resp(401, { msg: "invalid" });
  }
  if (u.startsWith("https://api.mercadopago.com")) return mercadoPago(u, init);
  if (u.startsWith("https://api.telegram.org/")) { est.telegram.push(JSON.parse(init.body).text); return resp(200, { ok: true }); }
  return fetchReal(url, init);
};

/* ---------- chamada de funções sem servidor ---------- */
function chamar(handler, { method = "GET", body, query = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const saida = { status: 200, headers: {}, corpo: undefined };
    const res = {
      setHeader: (k, v) => { saida.headers[k.toLowerCase()] = v; },
      status(c) { saida.status = c; return this; },
      json(o) { saida.corpo = o; resolve(saida); return this; },
      send(t) { saida.corpo = t; resolve(saida); return this; },
    };
    Promise.resolve(handler({ method, body, query, headers }, res)).catch(reject);
  });
}

const api = (nome) => require(path.join(__dirname, "..", "api", nome));

module.exports = { est, reiniciar, chamar, api, aprovar, definirStatus, PNG_1x1, SB, resp };
