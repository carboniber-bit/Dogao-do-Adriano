// Testes da API (sem rede): Supabase e Mercado Pago simulados. Rodar: node tests/api.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const h = require("./harness");
const { est, chamar, api, aprovar, definirStatus } = h;

const checkout = api("checkout.js"), pedido = api("pedido.js"), webhook = api("webhook.js"), conta = api("conta.js"), admin = api("admin.js"), status = api("status.js"), menu = api("menu.js");

const base = (extra = {}) => ({ nome: "Maria da Silva", telefone: "(11) 99999-1234", tipo: "Delivery", endereco: "Rua das Flores, 123", obs: "", email: "maria@exemplo.com",
  itens: [{ id: "agua", q: 2 }], ...extra });
const pedirPix = (extra, headers) => chamar(checkout, { method: "POST", body: { ...base(), modo: "pix", ...extra }, headers });
const consultar = (ref) => chamar(pedido, { query: { ref } });
const doDb = (ref) => est.tabelas.pedidos.find((p) => p.ref === ref);

async function comRelogio(iso, fn) {
  const Real = Date, fixo = new Real(iso).getTime();
  global.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixo); } static now() { return fixo; } };
  process.env.IGNORAR_HORARIO = "";
  try { return await fn(); } finally { global.Date = Real; process.env.IGNORAR_HORARIO = "1"; }
}
async function capturandoErros(fn) {
  const orig = console.error, linhas = [];
  console.error = (...a) => linhas.push(a.map(String).join(" "));
  try { return [await fn(), linhas.join("\n")]; } finally { console.error = orig; }
}

beforeEach(() => { h.reiniciar(); api("_horario.js").limparCache(); process.env.IGNORAR_HORARIO = "1"; delete process.env.MP_WEBHOOK_SECRET; });

/* ===== 1. Pix: criação ===== */
test("Pix: 200 com copia e qr; pedido aguardando_pagamento com mp_payment_id e mp_metodo=Pix", async () => {
  const r = await pedirPix();
  assert.equal(r.status, 200);
  assert.ok(r.corpo.pix.copia.startsWith("000201"));
  assert.ok(r.corpo.pix.qr.length > 20);
  assert.ok(r.corpo.pix.expira && r.corpo.pix.url && r.corpo.pix.id);
  const p = doDb(r.corpo.ref);
  assert.equal(p.status, "aguardando_pagamento");
  assert.equal(p.forma, "online");
  assert.equal(p.mp_payment_id, r.corpo.pix.id);
  assert.equal(p.mp_metodo, "Pix");
  assert.equal(p.user_id, null);
});

test("Pix: corpo enviado ao Mercado Pago segue a especificação", async () => {
  const r = await pedirPix();
  const { headers, body } = est.mp.chamadasCriar[0];
  assert.equal(headers["X-Idempotency-Key"], r.corpo.ref);
  assert.equal(headers.Authorization, `Bearer ${process.env.MP_ACCESS_TOKEN}`);
  assert.equal(body.payment_method_id, "pix");
  assert.equal(body.external_reference, r.corpo.ref);
  assert.equal(body.notification_url, "https://dogao.test/api/webhook");
  assert.equal(body.description, `Dogão do Adriano ${r.corpo.ref}`);
  assert.deepEqual(body.payer, { email: "maria@exemplo.com", first_name: "Maria", last_name: "da Silva" });
  assert.match(body.date_of_expiration, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}-03:00$/);
  const dif = Date.parse(body.date_of_expiration) - Date.now();
  assert.ok(dif > 29 * 60000 && dif < 31 * 60000, "expira em ~30 min, deu " + dif);
  assert.equal("statement_descriptor" in body, false);
  assert.equal(body.metadata.ref, r.corpo.ref);
  assert.match(body.metadata.pedido, /2x Água/);
  assert.ok(body.additional_info.items.length >= 1);
});

test("Pix: nome de uma palavra só usa o primeiro nome como sobrenome", async () => {
  await pedirPix({ nome: "Cher" });
  assert.deepEqual([est.mp.chamadasCriar[0].body.payer.first_name, est.mp.chamadasCriar[0].body.payer.last_name], ["Cher", "Cher"]);
});

test("Pix: total vem do servidor mesmo com preço adulterado no navegador", async () => {
  const r = await pedirPix({ itens: [{ id: "agua", q: 2, preco: 0.01, unit_price: 0.01 }], total: 0.02, subtotal: 0.02, taxa: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.total, 16); // 2 x 5 + taxa 6
  assert.equal(est.mp.chamadasCriar[0].body.transaction_amount, 16);
  const p = doDb(r.corpo.ref);
  assert.deepEqual([p.subtotal, p.taxa, p.total], [10, 6, 16]);
  assert.equal(p.itens[0].preco, 5);
});

test("Pix: retirada não cobra taxa; item com pão escolhido", async () => {
  const r = await pedirPix({ tipo: "Retirada", itens: [{ id: "tradicional", pao: "Sal", q: 1 }] });
  assert.equal(r.corpo.total, 18);
  assert.equal(doDb(r.corpo.ref).itens[0].pao, "Sal");
});

test("Pix: usuário logado grava user_id", async () => {
  const r = await pedirPix({}, { authorization: "Bearer tok-cliente" });
  assert.equal(doDb(r.corpo.ref).user_id, "u-cliente");
});

test("Pix: o e-mail não é gravado no banco nem aparece nos logs", async () => {
  const [r, logs] = await capturandoErros(async () => { const x = await pedirPix(); est.mp.falhar = { status: 400, corpo: { message: "erro com maria@exemplo.com" } }; await pedirPix(); return x; });
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(est.tabelas).includes("maria@exemplo.com"), false);
  assert.equal(logs.includes("maria@exemplo.com"), false);
  assert.equal(logs.includes(process.env.MP_ACCESS_TOKEN), false);
});

/* ===== 2. Validações ===== */
test("Pix: e-mail ausente ou inválido -> 400", async () => {
  for (const email of [undefined, "", "   ", "sem-arroba", "a@b", "a b@c.com", "x".repeat(121) + "@a.com"]) {
    const r = await pedirPix({ email });
    assert.equal(r.status, 400, `email=${email}`);
    assert.equal(r.corpo.erro, "Informe um e-mail válido para o Pix.");
  }
  assert.equal(est.tabelas.pedidos.length, 0);
  assert.equal(est.mp.chamadasCriar.length, 0);
});

test("Pix: fora do horário -> 409 e nada é gravado", async () => {
  // terça-feira 22:00 em São Paulo: delivery não funciona às terças
  const r = await comRelogio("2026-10-28T01:00:00Z", () => pedirPix({ tipo: "Delivery" }));
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /^Fechado agora\./);
  // quarta 12:00: retirada ainda fechada
  const r2 = await comRelogio("2026-10-28T15:00:00Z", () => pedirPix({ tipo: "Retirada" }));
  assert.equal(r2.status, 409);
  assert.equal(est.tabelas.pedidos.length, 0);
  assert.equal(est.mp.chamadasCriar.length, 0);
});

test("Pix: item inexistente, desativado, de encomenda ou quantidade inválida -> 400", async () => {
  for (const itens of [[{ id: "nao-existe", q: 1 }], [{ id: "sumido", q: 1 }], [{ id: "festa", q: 1 }], [{ id: "agua", q: 0 }], [{ id: "agua", q: 21 }], [{ id: "agua", q: 1.5 }], []]) {
    const r = await pedirPix({ itens });
    assert.equal(r.status, 400, JSON.stringify(itens));
  }
  assert.equal(est.tabelas.pedidos.length, 0);
});

test("Pix: demais validações (nome, telefone, tipo, endereço) e método", async () => {
  assert.equal((await pedirPix({ nome: "A" })).status, 400);
  assert.equal((await pedirPix({ telefone: "123" })).status, 400);
  assert.equal((await pedirPix({ tipo: "Voando" })).status, 400);
  assert.equal((await pedirPix({ endereco: "x" })).status, 400);
  assert.equal((await chamar(checkout, { method: "GET" })).status, 405);
});

test("Pix: sem MP_ACCESS_TOKEN -> 503", async () => {
  const t = process.env.MP_ACCESS_TOKEN; delete process.env.MP_ACCESS_TOKEN;
  try { assert.equal((await pedirPix()).status, 503); } finally { process.env.MP_ACCESS_TOKEN = t; }
});

test("Pix: se não conseguir gravar o pedido -> 500 e não cobra", async () => {
  est.dbFalhaPedidos = true;
  const [r] = await capturandoErros(() => pedirPix());
  assert.equal(r.status, 500);
  assert.equal(est.mp.chamadasCriar.length, 0);
});

/* ===== 3. Falha do Mercado Pago ===== */
test("Pix: erro de chave Pix no MP -> 502 amigável e pedido cancelado", async () => {
  est.mp.falhar = { status: 400, corpo: { message: "Collector user without key enabled for QR render", error: "bad_request", status: 400 } };
  const [r, logs] = await capturandoErros(() => pedirPix());
  assert.equal(r.status, 502);
  assert.equal(r.corpo.erro, "Pix indisponível no momento. Pague com cartão ou combine pelo WhatsApp.");
  assert.equal(est.tabelas.pedidos.length, 1);
  assert.equal(est.tabelas.pedidos[0].status, "cancelado");
  assert.match(logs, /Collector user without key enabled for QR render/); // log detalhado para o dono
  assert.match(logs, /400/);
});

test("Pix: resposta do MP sem transaction_data também cancela", async () => {
  const antes = global.fetch;
  global.fetch = async (u, i) => (String(u).endsWith("/v1/payments") && i.method === "POST" ? h.resp(201, { id: 1, status: "pending" }) : antes(u, i));
  try {
    const [r] = await capturandoErros(() => pedirPix());
    assert.equal(r.status, 502);
    assert.equal(est.tabelas.pedidos[0].status, "cancelado");
  } finally { global.fetch = antes; }
});

test("Pix: falha de rede com o MP -> 502 e pedido cancelado", async () => {
  const antes = global.fetch;
  global.fetch = async (u, i) => { if (String(u).includes("mercadopago.com")) throw new Error("ECONNRESET"); return antes(u, i); };
  try {
    const [r] = await capturandoErros(() => pedirPix());
    assert.equal(r.status, 502);
    assert.equal(est.tabelas.pedidos[0].status, "cancelado");
  } finally { global.fetch = antes; }
});

/* ===== 4. /api/pedido, webhook, aviso único ===== */
test("/api/pedido: aguardando -> aprovação no MP -> pago, aviso Telegram uma única vez (webhook + polling)", async () => {
  const { corpo: { ref, pix } } = await pedirPix();
  assert.deepEqual((await consultar(ref)).corpo, { status: "aguardando_pagamento" });
  assert.deepEqual((await consultar(ref)).corpo, { status: "aguardando_pagamento" });
  assert.equal(est.telegram.length, 0);

  aprovar(pix.id);
  const hook = () => chamar(webhook, { method: "POST", body: { type: "payment", data: { id: pix.id } } });
  const rs = await Promise.all([consultar(ref), hook(), consultar(ref), hook(), consultar(ref)]);
  rs.filter((r) => r.corpo && r.corpo.status).forEach((r) => assert.equal(r.corpo.status, "pago"));
  rs.filter((r) => r.corpo === "ok").forEach((r) => assert.equal(r.status, 200));
  await hook(); await consultar(ref); await hook();

  assert.deepEqual((await consultar(ref)).corpo, { status: "pago" });
  assert.equal(est.telegram.length, 1, "o aviso deve sair uma única vez");
  assert.match(est.telegram[0], /^✅ PAGAMENTO APROVADO \(Pix\)\n\nPedido /);
  assert.match(est.telegram[0], /2x Água/);
  assert.match(est.telegram[0], /Nome: Maria da Silva/);
  const p = doDb(ref);
  assert.equal(p.status, "pago"); assert.equal(p.mp_metodo, "Pix"); assert.equal(p.mp_payment_id, pix.id); assert.ok(p.pago_em);
});

test("webhook sozinho: aprovado marca pago e avisa uma vez; polling depois não reenvia", async () => {
  const { corpo: { ref, pix } } = await pedirPix();
  aprovar(pix.id);
  for (let i = 0; i < 3; i++) assert.equal((await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: pix.id } } })).status, 200);
  await consultar(ref);
  assert.equal(est.telegram.length, 1);
});

test("webhook: id em query string (formato antigo) e tópico diferente de payment é ignorado", async () => {
  const { corpo: { pix } } = await pedirPix();
  aprovar(pix.id);
  const antes = est.mp.chamadasConsulta;
  await chamar(webhook, { method: "POST", query: { topic: "merchant_order", id: pix.id } });
  assert.equal(est.mp.chamadasConsulta, antes);
  assert.equal((await chamar(webhook, { method: "POST", query: { topic: "payment", id: pix.id } })).status, 200);
  assert.equal(est.telegram.length, 1);
});

test("webhook: consulta ao MP falhou -> 500 (o MP reenvia)", async () => {
  const { corpo: { pix } } = await pedirPix();
  est.mp.consultaFalha = true;
  const r = await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: pix.id } } });
  assert.equal(r.status, 500);
});

test("webhook: assinatura (MP_WEBHOOK_SECRET) válida passa, inválida/ausente -> 401", async () => {
  const { corpo: { pix } } = await pedirPix();
  process.env.MP_WEBHOOK_SECRET = "segredo";
  const ts = "1700000000", rid = "req-1";
  const v1 = crypto.createHmac("sha256", "segredo").update(`id:${pix.id};request-id:${rid};ts:${ts};`).digest("hex");
  const corpo = { type: "payment", data: { id: pix.id } };
  assert.equal((await chamar(webhook, { method: "POST", body: corpo, headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid } })).status, 200);
  assert.equal((await chamar(webhook, { method: "POST", body: corpo, headers: { "x-signature": `ts=${ts},v1=${"0".repeat(64)}`, "x-request-id": rid } })).status, 401);
  assert.equal((await chamar(webhook, { method: "POST", body: corpo })).status, 401);
});

test("rejeitado -> recusado; depois aprovado -> pago (aviso uma vez); cancelado/estornado -> cancelado", async () => {
  const a = (await pedirPix()).corpo, b = (await pedirPix()).corpo;
  definirStatus(a.pix.id, "rejected");
  assert.deepEqual((await consultar(a.ref)).corpo, { status: "recusado" }); // /api/pedido aplica o rejected e relê
  assert.equal(doDb(a.ref).status, "recusado");
  aprovar(a.pix.id);
  await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: a.pix.id } } });
  assert.equal(doDb(a.ref).status, "pago"); assert.equal(est.telegram.length, 1);

  definirStatus(b.pix.id, "cancelled");
  await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: b.pix.id } } });
  assert.equal(doDb(b.ref).status, "cancelado");
  definirStatus(a.pix.id, "refunded");
  await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: a.pix.id } } });
  assert.equal(doDb(a.ref).status, "cancelado");
});

test("mp_metodo: cartão de crédito/débito e outros", async () => {
  const mk = async (extra) => { const r = (await pedirPix()).corpo; est.tabelas.pedidos.find((p) => p.ref === r.ref).mp_metodo = null; aprovar(r.pix.id, extra); await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: r.pix.id } } }); return doDb(r.ref).mp_metodo; };
  assert.equal(await mk({ payment_method_id: "visa", payment_type_id: "credit_card" }), "Cartão de crédito");
  assert.equal(await mk({ payment_method_id: "debvisa", payment_type_id: "debit_card" }), "Cartão de débito");
  assert.equal(await mk({ payment_method_id: "account_money", payment_type_id: "account_money" }), "account_money");
  assert.equal(await mk({}), "Pix");
});

/* ===== 5. /api/pedido: validação e privacidade ===== */
test("/api/pedido: ref inválido 400, inexistente 404, método 405, no-store", async () => {
  for (const ref of ["", "abc", "minúsculo123", "DA-123456", "A".repeat(25), "DA123456'; drop", undefined]) assert.equal((await consultar(ref)).status, 400, String(ref));
  const r = await consultar("DAINEXISTENTE");
  assert.equal(r.status, 404);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal((await chamar(pedido, { method: "POST", query: { ref: "DAINEXISTENTE" } })).status, 405);
});

test("/api/pedido: resposta nunca contém dados pessoais, em nenhum status", async () => {
  const { corpo: { ref, pix } } = await pedirPix({ nome: "Fulano Sigiloso", telefone: "11988887777", endereco: "Rua Secreta 999", obs: "segredo" });
  for (const fase of ["pendente", "pago"]) {
    if (fase === "pago") aprovar(pix.id);
    const r = await consultar(ref);
    assert.deepEqual(Object.keys(r.corpo), ["status"]);
    const txt = JSON.stringify(r);
    for (const sens of ["Fulano", "11988887777", "Secreta", "segredo", "maria@", "9000"]) assert.equal(txt.includes(sens), false, sens);
  }
});

test("/api/pedido: sem banco configurado -> 400", async () => {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // _lib lê as variáveis ao carregar; recarrega o módulo sem a chave para simular "sem banco"
  const caminhos = ["_lib.js", "_pagamento.js", "pedido.js"].map((n) => require.resolve("../api/" + n));
  const guardados = caminhos.map((c) => [c, require.cache[c]]);
  caminhos.forEach((c) => delete require.cache[c]);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  try { assert.equal((await chamar(require("../api/pedido.js"), { query: { ref: "DAABCDEF12" } })).status, 400); }
  finally { process.env.SUPABASE_SERVICE_ROLE_KEY = k; caminhos.forEach((c) => delete require.cache[c]); guardados.forEach(([c, m]) => { require.cache[c] = m; }); }
});

test("/api/pedido: falha ao consultar o MP não derruba; devolve o status atual", async () => {
  const { corpo: { ref } } = await pedirPix();
  est.mp.consultaFalha = true;
  assert.deepEqual((await consultar(ref)).corpo, { status: "aguardando_pagamento" });
});

/* ===== 7. Regressão ===== */
test("regressão: cartão (Checkout Pro) continua gerando a preferência", async () => {
  const r = await chamar(checkout, { method: "POST", body: base({ email: undefined }) });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.url, "https://mp.test/checkout/pref-1");
  const pref = est.mp.ultimaPreferencia;
  assert.equal(pref.external_reference, r.corpo.ref);
  assert.equal(pref.items.at(-1).id, "taxa");
  assert.equal(doDb(r.corpo.ref).status, "aguardando_pagamento");
  assert.equal(est.mp.chamadasCriar.length, 0); // não usou /v1/payments
});

test("regressão: cartão não exige e-mail e aprovado pelo webhook marca 'Cartão de crédito'", async () => {
  const r = await chamar(checkout, { method: "POST", body: base({ email: undefined }) });
  est.mp.pagamentos.set("55", { id: 55, status: "approved", external_reference: r.corpo.ref, payment_method_id: "master", payment_type_id: "credit_card", metadata: { pedido: "Pedido " + r.corpo.ref } });
  await chamar(webhook, { method: "POST", body: { type: "payment", data: { id: 55 } } });
  assert.equal(doDb(r.corpo.ref).status, "pago");
  assert.equal(doDb(r.corpo.ref).mp_metodo, "Cartão de crédito");
  assert.match(est.telegram[0], /\(Cartão de crédito\)/);
});

test("regressão: pedido por WhatsApp (a_combinar) e fora do horário continua permitido", async () => {
  const r = await comRelogio("2026-10-28T01:00:00Z", () => chamar(checkout, { method: "POST", body: base({ modo: "whatsapp", email: undefined }) }));
  assert.equal(r.status, 200);
  const p = doDb(r.corpo.ref);
  assert.equal(p.status, "a_combinar"); assert.equal(p.forma, "whatsapp"); assert.equal(p.total, 16);
  assert.equal(est.mp.chamadasCriar.length, 0);
});

test("WhatsApp: avisa no Telegram uma vez, com texto de 'pagar na entrega' e sem marcar como pago", async () => {
  const r = await chamar(checkout, { method: "POST", body: base({ modo: "whatsapp", email: undefined }) });
  assert.equal(r.status, 200);
  assert.equal(est.telegram.length, 1);
  assert.match(est.telegram[0], /^🕒 NOVO PEDIDO \(pagar na entrega\/retirada\)\n\nPedido /);
  assert.match(est.telegram[0], new RegExp(r.corpo.ref));
  assert.match(est.telegram[0], /2x Água/);
  assert.equal(est.telegram[0].includes("PAGAMENTO APROVADO"), false);
  assert.equal(doDb(r.corpo.ref).status, "a_combinar");
});

test("WhatsApp: pedido inválido não avisa; falha do Telegram não derruba o pedido", async () => {
  assert.equal((await chamar(checkout, { method: "POST", body: base({ modo: "whatsapp", nome: "A" }) })).status, 400);
  assert.equal(est.telegram.length, 0);
  const antes = global.fetch;
  global.fetch = async (u, i) => { if (String(u).includes("api.telegram.org")) throw new Error("rede"); return antes(u, i); };
  try {
    const [r] = await capturandoErros(() => chamar(checkout, { method: "POST", body: base({ modo: "whatsapp" }) }));
    assert.equal(r.status, 200);
    assert.equal(est.tabelas.pedidos.length, 1);
  } finally { global.fetch = antes; }
});

test("regressão: /api/status, /api/menu e /api/conta", async () => {
  const s = await chamar(status); assert.equal(s.corpo.pagamentoOnline, true); assert.ok(s.corpo.auth);
  const m = await chamar(menu); assert.equal(m.status, 200);
  assert.equal((await chamar(conta)).status, 401);
  const c = await chamar(conta, { headers: { authorization: "Bearer tok-cliente" } });
  assert.equal(c.status, 200); assert.equal(c.corpo.perfil.email, "cliente@teste.com");
  const pr = (await pedirPix({}, { authorization: "Bearer tok-cliente" })).corpo;
  assert.equal((await chamar(conta, { headers: { authorization: "Bearer tok-cliente" } })).corpo.pedidos.length, 0); // aguardando não aparece
  aprovar(pr.pix.id); await consultar(pr.ref);
  const c2 = await chamar(conta, { headers: { authorization: "Bearer tok-cliente" } });
  assert.equal(c2.corpo.pedidos[0].ref, pr.ref);
});

test("regressão: painel /admin exige admin e lista pedidos Pix com mp_metodo", async () => {
  const adm = (a, extra = {}) => chamar(admin, { query: { a }, headers: { authorization: "Bearer tok-admin" }, ...extra });
  assert.equal((await chamar(admin, { query: { a: "pedidos" } })).status, 401);
  assert.equal((await chamar(admin, { query: { a: "pedidos" }, headers: { authorization: "Bearer tok-cliente" } })).status, 403);
  const pr = (await pedirPix()).corpo;
  assert.equal((await adm("pedidos")).corpo.pedidos.length, 0); // aguardando_pagamento não aparece por padrão
  aprovar(pr.pix.id); await consultar(pr.ref);
  const l = (await adm("pedidos")).corpo.pedidos;
  assert.equal(l.length, 1); assert.equal(l[0].mp_metodo, "Pix"); assert.equal(l[0].forma, "online");
  assert.equal((await adm("resumo", { query: { a: "resumo", dias: "7" } })).corpo.kpis.pedidos, 1);
  const nv = await adm("novos"); assert.deepEqual(nv.corpo.refs, [pr.ref]);
  assert.equal((await chamar(admin, { query: { a: "novos" } })).status, 401);
  assert.equal((await chamar(admin, { query: { a: "novos" }, headers: { authorization: "Bearer tok-cliente" } })).status, 403);
  assert.equal((await adm("itens")).status, 200);
  const st = await adm("pedido_status", { method: "POST", body: { id: l[0].id, status: "em_preparo" } });
  assert.equal(st.status, 200);
  assert.equal((await adm("historico")).status, 200);
  assert.equal((await adm("equipe")).status, 200);
});

/* ===== Etapa E: horários editáveis ===== */
const horario = api("_horario.js");
const semIgnorar = (fn) => { process.env.IGNORAR_HORARIO = ""; try { return fn(); } finally { process.env.IGNORAR_HORARIO = "1"; } };
const em = (iso, tipo, cfg) => semIgnorar(() => horario.status(tipo, new Date(iso), cfg));
const salvarHorarios = (h, token = "tok-admin") => chamar(admin, { method: "POST", query: { a: "horarios" }, body: h, headers: { authorization: "Bearer " + token } });

test("horários: padrão igual ao antigo (retirada 18:30–05:00; delivery 18:30–01:00 sem terças)", () => {
  // 28/10/2026 é quarta-feira; São Paulo = UTC-3
  assert.equal(em("2026-10-28T22:00:00Z", "Retirada").aberto, true);   // qua 19:00
  assert.equal(em("2026-10-28T22:00:00Z", "Delivery").aberto, true);
  assert.equal(em("2026-10-29T04:00:00Z", "Retirada").aberto, true);   // qui 01:00 (turno de quarta)
  assert.equal(em("2026-10-29T04:00:00Z", "Delivery").aberto, false);  // delivery fecha 01:00
  assert.equal(em("2026-10-29T07:59:00Z", "Retirada").aberto, true);   // qui 04:59
  assert.equal(em("2026-10-29T08:00:00Z", "Retirada").aberto, false);  // qui 05:00
  assert.equal(em("2026-10-28T15:00:00Z", "Retirada").aberto, false);  // qua 12:00
  assert.equal(em("2026-10-28T15:00:00Z", "Retirada").msg, "Atendemos das 18:30 às 05:00.");
  assert.equal(em("2026-10-28T15:00:00Z", "Delivery").msg, "O delivery funciona das 18:30 às 01:00.");
  const terca = em("2026-10-28T01:00:00Z", "Delivery");                // ter 22:00
  assert.deepEqual([terca.aberto, terca.msg], [false, "Não fazemos entregas às terças. Você pode retirar na praça."]);
  assert.equal(em("2026-10-28T01:00:00Z", "Retirada").aberto, true);
  const madrugadaTerca = em("2026-10-28T03:30:00Z", "Delivery");       // qua 00:30 = turno de terça
  assert.deepEqual([madrugadaTerca.aberto, madrugadaTerca.msg.includes("terças")], [false, true]);
  assert.equal(em("2026-10-28T03:30:00Z", "Retirada").aberto, true);
});

test("horários: configuração própria (dia, janela no mesmo dia e janela que passa da meia-noite)", () => {
  const cfg = { Retirada: { abre: "10:00", fecha: "14:00", dias: [3] }, Delivery: { abre: "22:00", fecha: "02:00", dias: [3] } };
  assert.equal(em("2026-10-28T15:00:00Z", "Retirada", cfg).aberto, true);    // qua 12:00
  assert.equal(em("2026-10-28T17:00:00Z", "Retirada", cfg).aberto, false);   // qua 14:00
  const qui = em("2026-10-29T15:00:00Z", "Retirada", cfg);                   // qui 12:00
  assert.deepEqual([qui.aberto, qui.msg], [false, "Não atendemos às quintas."]);
  assert.equal(em("2026-10-29T01:30:00Z", "Delivery", cfg).aberto, true);    // qua 22:30
  assert.equal(em("2026-10-29T04:00:00Z", "Delivery", cfg).aberto, true);    // qui 01:00 (turno de quarta)
  assert.equal(em("2026-10-29T05:00:00Z", "Delivery", cfg).aberto, false);   // qui 02:00
  assert.equal(em("2026-10-28T15:00:00Z", "Delivery", cfg).msg, "O delivery funciona das 22:00 às 02:00.");
  assert.equal(em("2026-10-28T15:00:00Z", "Retirada", { Retirada: { abre: "10:00", fecha: "14:00", dias: [] }, Delivery: cfg.Delivery }).aberto, false);
});

test("painel: GET devolve o padrão; POST valida, grava, audita e vale na hora para /api/status e checkout", async () => {
  const adm = (a) => chamar(admin, { query: { a }, headers: { authorization: "Bearer tok-admin" } });
  assert.deepEqual((await adm("horarios")).corpo.horarios, horario.PADRAO);
  for (const ruim of [null, {}, { Retirada: { abre: "10:00", fecha: "14:00", dias: [3] } },
    { Retirada: { abre: "25:00", fecha: "14:00", dias: [3] }, Delivery: horario.PADRAO.Delivery },
    { Retirada: { abre: "10:00", fecha: "10:00", dias: [3] }, Delivery: horario.PADRAO.Delivery },
    { Retirada: { abre: "10:00", fecha: "14:00", dias: [7] }, Delivery: horario.PADRAO.Delivery },
    { Retirada: { abre: "10:00", fecha: "14:00", dias: "3" }, Delivery: horario.PADRAO.Delivery },
    { Retirada: { abre: "10:0", fecha: "14:00", dias: [3] }, Delivery: horario.PADRAO.Delivery }]) {
    assert.equal((await salvarHorarios(ruim)).status, 400, JSON.stringify(ruim));
  }
  assert.equal(est.tabelas.config.some((c) => c.chave === "horarios"), false);
  assert.equal((await salvarHorarios(horario.PADRAO, "tok-cliente")).status, 403);
  assert.equal((await chamar(admin, { method: "POST", query: { a: "horarios" }, body: horario.PADRAO })).status, 401);

  const novo = { Retirada: { abre: "10:00", fecha: "14:00", dias: [3, 3, 4] }, Delivery: { abre: "11:00", fecha: "13:00", dias: [] } };
  const ok = await salvarHorarios(novo);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.corpo.horarios.Retirada.dias, [3, 4]); // duplicados removidos
  assert.equal(est.tabelas.auditoria.at(-1).acao, "horarios");
  assert.deepEqual((await adm("horarios")).corpo.horarios.Delivery.dias, []);
  assert.equal((await chamar(admin, { query: { a: "horarios" }, method: "GET", headers: { authorization: "Bearer tok-admin" } })).status, 200);

  const st = (await chamar(status)).corpo;
  assert.equal(st.horarios.Retirada.abre, "10:00");
  assert.equal(JSON.stringify(st.horarios).includes("tok-"), false);

  // checkout respeita: quarta 12:00 retirada aberta (config nova); delivery sem dias fechado
  const r1 = await comRelogio("2026-10-28T15:00:00Z", () => pedirPix({ tipo: "Retirada" }));
  assert.equal(r1.status, 200);
  const r2 = await comRelogio("2026-10-28T15:00:00Z", () => pedirPix({ tipo: "Delivery" }));
  assert.equal(r2.status, 409);
  assert.match(r2.corpo.erro, /Não fazemos entregas às quartas/);
  // quarta 19:00: com o horário antigo estaria aberto, com o novo está fechado
  assert.equal((await comRelogio("2026-10-28T22:00:00Z", () => pedirPix({ tipo: "Retirada" }))).status, 409);
});

test("horários: configuração salva inválida no banco ou banco fora do ar cai no padrão", async () => {
  est.tabelas.config.push({ chave: "horarios", valor: { Retirada: { abre: "lixo" } } });
  assert.deepEqual(await horario.horarios(), horario.PADRAO);
  horario.limparCache();
  const antes = global.fetch;
  global.fetch = async (u, i) => (String(u).includes("config?chave=eq.horarios") ? h.resp(500, {}) : antes(u, i));
  try { const [v] = await capturandoErros(() => horario.horarios()); assert.deepEqual(v, horario.PADRAO); } finally { global.fetch = antes; }
});

/* ===== Etapa F: taxa por bairro ===== */
const comBairros = () => est.tabelas.config.push({ chave: "bairros", valor: [{ nome: "Centro", taxa: 4 }, { nome: "Vila Nova", taxa: 9.5 }, { nome: "Grátis", taxa: 0 }] });
const salvarBairros = (bairros, token = "tok-admin") => chamar(admin, { method: "POST", query: { a: "bairros" }, body: { bairros }, headers: { authorization: "Bearer " + token } });

test("bairros: sem lista cadastrada, a taxa única continua valendo e o bairro enviado é ignorado", async () => {
  const r = await pedirPix({ bairro: "Centro" });
  assert.equal(r.corpo.total, 16);
  assert.equal(doDb(r.corpo.ref).endereco, "Rua das Flores, 123");
  assert.deepEqual((await chamar(menu)).corpo.bairros, []);
});

test("bairros: taxa do bairro escolhido, calculada no servidor (Pix, cartão e WhatsApp)", async () => {
  comBairros();
  const r = await pedirPix({ bairro: "Vila Nova", taxa: 0, total: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.total, 19.5); // 2 x R$5 + 9,50
  assert.equal(est.mp.chamadasCriar[0].body.transaction_amount, 19.5);
  const p = doDb(r.corpo.ref);
  assert.deepEqual([p.subtotal, p.taxa, p.total], [10, 9.5, 19.5]);
  assert.equal(p.endereco, "Rua das Flores, 123 (bairro: Vila Nova)");
  assert.match(est.mp.chamadasCriar[0].body.metadata.pedido, /\(bairro: Vila Nova\)/);

  const c = await chamar(checkout, { method: "POST", body: base({ bairro: "Centro", email: undefined }) });
  assert.equal(c.corpo.total, 14);
  const taxaItem = est.mp.ultimaPreferencia.items.at(-1);
  assert.deepEqual([taxaItem.id, taxaItem.title, taxaItem.unit_price], ["taxa", "Taxa de entrega (Centro)", 4]);

  const z = await chamar(checkout, { method: "POST", body: base({ modo: "whatsapp", bairro: "Grátis", email: undefined }) });
  assert.equal(z.corpo.total, 10);
  assert.equal(doDb(z.corpo.ref).taxa, 0);
  assert.match(est.telegram.at(-1), /Endereço: Rua das Flores, 123 \(bairro: Grátis\)/);
});

test("bairros: 'Outro bairro' usa a taxa padrão; bairro ausente ou desconhecido -> 400; retirada não pede bairro", async () => {
  comBairros();
  assert.equal((await pedirPix({ bairro: "__outro" })).corpo.total, 16);
  for (const bairro of [undefined, "", "Inexistente", "centro", "__OUTRO"]) {
    const r = await pedirPix({ bairro });
    assert.equal(r.status, 400, String(bairro));
    assert.equal(r.corpo.erro, "Escolha o bairro da entrega.");
  }
  const antes = est.tabelas.pedidos.length;
  const ret = await pedirPix({ tipo: "Retirada", bairro: undefined });
  assert.equal(ret.corpo.total, 10);
  assert.equal(doDb(ret.corpo.ref).endereco, null);
  assert.equal(est.tabelas.pedidos.length, antes + 1);
});

test("bairros: /api/menu publica a lista; lista inválida no banco é ignorada linha a linha", async () => {
  est.tabelas.config.push({ chave: "bairros", valor: [{ nome: "Centro", taxa: 4 }, { nome: "x", taxa: 1 }, { nome: "Centro", taxa: 7 }, { nome: "Caro", taxa: 500 }, { nome: "Texto", taxa: "abc" }, null, { nome: "Boa Vista", taxa: "5.5" }] });
  assert.deepEqual((await chamar(menu)).corpo.bairros, [{ nome: "Centro", taxa: 4 }, { nome: "Boa Vista", taxa: 5.5 }]);
});

test("bairros: painel valida (estrito), grava, audita e vale na hora; exige admin", async () => {
  const adm = (a) => chamar(admin, { query: { a }, headers: { authorization: "Bearer tok-admin" } });
  assert.deepEqual((await adm("bairros")).corpo, { bairros: [], taxaEntrega: 6 });
  for (const ruim of [null, "Centro", [{ nome: "A", taxa: 1 }], [{ nome: "Centro", taxa: 1 }, { nome: "centro", taxa: 2 }], [{ nome: "Centro", taxa: -1 }],
    [{ nome: "Centro", taxa: 101 }], [{ nome: "Centro", taxa: "x" }], [{ nome: "Centro", taxa: 1 }, null], Array.from({ length: 61 }, (_, i) => ({ nome: "Bairro " + i, taxa: 1 }))]) {
    assert.equal((await salvarBairros(ruim)).status, 400, JSON.stringify(ruim)?.slice(0, 60));
  }
  assert.equal(est.tabelas.config.some((c) => c.chave === "bairros"), false);
  assert.equal((await salvarBairros([{ nome: "Centro", taxa: 4 }], "tok-cliente")).status, 403);
  assert.equal((await chamar(admin, { method: "POST", query: { a: "bairros" }, body: { bairros: [] } })).status, 401);
  const ok = await salvarBairros([{ nome: " Centro ", taxa: "4,5".replace(",", ".") }, { nome: "Vila Nova", taxa: 9 }]);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.corpo.bairros, [{ nome: "Centro", taxa: 4.5 }, { nome: "Vila Nova", taxa: 9 }]);
  assert.equal(est.tabelas.auditoria.at(-1).acao, "bairros");
  assert.equal((await pedirPix({ bairro: "Centro" })).corpo.total, 14.5);
  assert.equal((await salvarBairros([])).status, 200); // lista vazia volta à taxa única
  assert.equal((await pedirPix({ bairro: undefined })).corpo.total, 16);
});

/* ===== Adicionais dentro do lanche ===== */
test("adicionais: preço do lanche + adicionais calculado no servidor, em cada linha (Pix)", async () => {
  const r = await pedirPix({ tipo: "Retirada", itens: [
    { id: "tradicional", pao: "Sal", q: 2, adds: ["bacon", "queijo"], preco: 1, unit_price: 1 },   // 2 x (18 + 6 + 2) = 52
    { id: "tradicional", pao: "Sal", q: 1 },                                                         // 18
    { id: "agua", q: 1 }] });                                                                       // 5
  assert.equal(r.status, 200);
  assert.equal(r.corpo.total, 75);
  const p = doDb(r.corpo.ref);
  assert.deepEqual([p.subtotal, p.taxa, p.total], [75, 0, 75]);
  assert.deepEqual(p.itens[0], { id: "tradicional", nome: "Dogão Tradicional", pao: "Sal", q: 2, preco: 26, base: 18,
    adds: [{ id: "bacon", nome: "Bacon", preco: 6 }, { id: "queijo", nome: "Queijo ralado", preco: 2 }] });
  assert.deepEqual(p.itens[1].adds, []);
  const mp = est.mp.chamadasCriar[0].body;
  assert.equal(mp.transaction_amount, 75);
  assert.equal(mp.additional_info.items[0].title, "Dogão Tradicional (pão de sal) + Bacon + Queijo ralado");
  assert.equal(mp.additional_info.items[0].unit_price, 26);
  assert.match(mp.metadata.pedido, /2x Dogão Tradicional \(pão de sal\) \+ Bacon \+ Queijo ralado/);
});

test("adicionais: cartão e WhatsApp também montam a linha com adicionais (e o Telegram mostra)", async () => {
  const c = await chamar(checkout, { method: "POST", body: base({ email: undefined, tipo: "Retirada", itens: [{ id: "tradicional", q: 1, adds: ["pure"] }] }) });
  assert.equal(c.corpo.total, 24);
  const it = est.mp.ultimaPreferencia.items[0];
  assert.deepEqual([it.title, it.unit_price], ["Dogão Tradicional (pão de banha) + Purê", 24]);
  const z = await chamar(checkout, { method: "POST", body: base({ modo: "whatsapp", email: undefined, tipo: "Retirada", itens: [{ id: "tradicional", pao: "Sal", q: 2, adds: ["bacon", "pure"] }] }) });
  assert.equal(z.corpo.total, 60);
  assert.match(est.telegram.at(-1), /2x Dogão Tradicional \(pão de sal\) \+ Bacon \+ Purê/);
});

test("adicionais: recusa adicional avulso, em bebida, repetido, inexistente, desativado, de lanche, lista inválida ou excesso", async () => {
  const ruins = [
    [{ id: "bacon", q: 1 }],                                          // adicional avulso
    [{ id: "agua", q: 1, adds: ["bacon"] }],                          // bebida não aceita adicional
    [{ id: "tradicional", q: 1, adds: ["bacon", "bacon"] }],          // repetido
    [{ id: "tradicional", q: 1, adds: ["nao-existe"] }],              // inexistente
    [{ id: "tradicional", q: 1, adds: ["esgotado"] }],                // desativado
    [{ id: "tradicional", q: 1, adds: ["agua"] }],                    // não é adicional
    [{ id: "tradicional", q: 1, adds: ["tradicional"] }],             // lanche como adicional
    [{ id: "tradicional", q: 1, adds: "bacon" }],                     // formato errado
    [{ id: "tradicional", q: 1, adds: [{ id: "bacon" }] }],           // formato errado
    [{ id: "tradicional", q: 1, adds: Array.from({ length: 9 }, (_, i) => "x" + i) }],
    [{ id: "festa", q: 1, adds: ["bacon"] }],                         // encomenda
  ];
  for (const itens of ruins) {
    const r = await pedirPix({ itens });
    assert.equal(r.status, 400, JSON.stringify(itens).slice(0, 80));
    assert.equal(r.corpo.erro, "Um item do carrinho não está mais disponível. Atualize a página.");
  }
  assert.equal(est.tabelas.pedidos.length, 0);
  assert.equal(est.mp.chamadasCriar.length, 0);
});

test("adicionais: lista vazia ou ausente é o lanche puro; /api/menu continua publicando os adicionais", async () => {
  assert.equal((await pedirPix({ tipo: "Retirada", itens: [{ id: "tradicional", q: 1, adds: [] }] })).corpo.total, 18);
  assert.equal((await pedirPix({ tipo: "Retirada", itens: [{ id: "tradicional", q: 1 }] })).corpo.total, 18);
  const m = (await chamar(menu)).corpo;
  assert.deepEqual(m.itens.filter((i) => i.cat === "adicionais").map((i) => i.id).sort(), ["bacon", "pure", "queijo"]); // sem o desativado
});

test("adicionais: preço do adicional vem do banco (mudou no painel, muda na cobrança)", async () => {
  est.tabelas.itens.find((i) => i.id === "bacon").preco = 7.5;
  assert.equal((await pedirPix({ tipo: "Retirada", itens: [{ id: "tradicional", q: 1, adds: ["bacon"] }] })).corpo.total, 25.5);
});

test("limites: no máximo 12 funções serverless (arquivos sem '_' em api/)", () => {
  const fs = require("fs"), path = require("path");
  const fns = fs.readdirSync(path.join(__dirname, "..", "api")).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.deepEqual(fns.sort(), ["admin.js", "checkout.js", "conta.js", "menu.js", "pedido.js", "status.js", "webhook.js"]);
  assert.ok(fns.length <= 12);
});

test("segurança: tokens e chaves não aparecem em nenhuma resposta ao navegador", async () => {
  const rs = [await pedirPix(), await chamar(status), await chamar(menu)];
  const txt = JSON.stringify(rs);
  assert.equal(txt.includes(process.env.MP_ACCESS_TOKEN), false);
  assert.equal(txt.includes(process.env.SUPABASE_SERVICE_ROLE_KEY), false);
});

test("sem dependências npm", () => {
  const pkg = require("../package.json");
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.devDependencies, undefined);
});
