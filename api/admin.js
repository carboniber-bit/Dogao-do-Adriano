// API do painel administrativo. TODA ação passa por exigirAdmin() no servidor:
// só quem tem role "admin" no banco consegue ler ou alterar qualquer coisa aqui.
const { db, exigirAdmin, limpa, arred, ehUuid, ehId, enc, auditar, corpo } = require("./_lib");
const { carregarMenu } = require("./_menu");

const TZ = "America/Sao_Paulo";
const PAGOS = ["pago", "em_preparo", "pronto", "entregue"];
const STATUS_OK = ["a_combinar", "pago", "em_preparo", "pronto", "entregue", "cancelado"];

const diaSP = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const horaSP = (d) => parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d), 10) % 24;

function ultimosDias(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(diaSP(new Date(Date.now() - i * 86400000)));
  return out;
}

async function resumo(req, res) {
  const dias = [1, 7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 7;
  const dd = ultimosDias(dias * 2);              // período atual + o anterior, para comparar
  const atualDias = new Set(dd.slice(dias));
  const inicio = `${dd[0]}T00:00:00-03:00`;
  const rows = await db(`pedidos?select=ref,criado_em,total,tipo,itens,status&status=in.(${PAGOS.join(",")})&criado_em=gte.${enc(inicio)}&order=criado_em.desc&limit=10000`);

  const atual = [], anterior = [];
  for (const p of rows) (atualDias.has(diaSP(new Date(p.criado_em))) ? atual : anterior).push(p);

  const soma = (l) => arred(l.reduce((s, p) => s + Number(p.total), 0));
  const itensMap = new Map();
  let unidades = 0;
  for (const p of atual) for (const i of p.itens) {
    const k = i.id; const a = itensMap.get(k) || { id: k, nome: i.nome, q: 0, receita: 0 };
    a.q += i.q; a.receita = arred(a.receita + i.q * i.preco); itensMap.set(k, a); unidades += i.q;
  }
  const porDiaMap = new Map(dd.slice(dias).map((d) => [d, { dia: d, receita: 0, pedidos: 0 }]));
  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: 0 }));
  let delivery = 0;
  for (const p of atual) {
    const d = new Date(p.criado_em), x = porDiaMap.get(diaSP(d));
    if (x) { x.receita = arred(x.receita + Number(p.total)); x.pedidos++; }
    porHora[horaSP(d)].pedidos++;
    if (p.tipo === "Delivery") delivery++;
  }
  const novos = await db("pedidos?select=ref&status=in.(pago,a_combinar)&limit=500");

  res.status(200).json({
    dias,
    kpis: {
      receita: soma(atual), pedidos: atual.length, ticketMedio: atual.length ? arred(soma(atual) / atual.length) : 0, unidades,
      delivery, retirada: atual.length - delivery,
      receitaAnterior: soma(anterior), pedidosAnterior: anterior.length,
    },
    topItens: [...itensMap.values()].sort((a, b) => b.q - a.q).slice(0, 10),
    porDia: [...porDiaMap.values()],
    porHora,
    novos: novos.length,
  });
}

async function pedidos(req, res) {
  const f = String(req.query.status || "");
  const filtro = f === "todos" ? "" : STATUS_OK.includes(f) ? `&status=eq.${f}` : "&status=neq.aguardando_pagamento";
  const rows = await db(`pedidos?select=*${filtro}&order=criado_em.desc&limit=150`);
  res.status(200).json({ pedidos: rows });
}

async function pedidoStatus(req, res, ctx) {
  const b = corpo(req);
  if (!ehUuid(b.id) || !STATUS_OK.includes(b.status)) return res.status(400).json({ erro: "Dados inválidos." });
  const upd = { status: b.status };
  if (b.status === "pago") upd.pago_em = new Date().toISOString();
  const r = await db(`pedidos?id=eq.${enc(b.id)}`, { method: "PATCH", body: upd });
  if (!r.length) return res.status(404).json({ erro: "Pedido não encontrado." });
  await auditar(ctx.user.email, "pedido_status", { ref: r[0].ref, status: b.status });
  res.status(200).json({ ok: true, pedido: r[0] });
}

async function itens(req, res) {
  const m = await carregarMenu({ todos: true });
  res.status(200).json({ categorias: m.categorias, itens: m.itens, taxaEntrega: m.taxaEntrega });
}

const precoValido = (p) => Number.isFinite(p) && p >= 0 && p <= 5000;

async function itemSalvar(req, res, ctx) {
  const b = corpo(req);
  if (!ehId(b.id)) return res.status(400).json({ erro: "Item inválido." });
  const atual = await db(`itens?id=eq.${enc(b.id)}&select=*`);
  if (!atual.length) return res.status(404).json({ erro: "Item não encontrado." });
  const upd = {}, mudancas = {};
  if (b.preco !== undefined) {
    const p = arred(Number(b.preco));
    if (!precoValido(p)) return res.status(400).json({ erro: "Preço inválido." });
    if (p !== Number(atual[0].preco)) { upd.preco = p; mudancas.preco = [Number(atual[0].preco), p]; }
    upd.verificar = false; // preço revisado pelo administrador
  }
  if (b.ativo !== undefined) { upd.ativo = Boolean(b.ativo); if (upd.ativo !== atual[0].ativo) mudancas.ativo = [atual[0].ativo, upd.ativo]; }
  if (b.nome !== undefined) { const n = limpa(b.nome, 80); if (n.length < 2) return res.status(400).json({ erro: "Nome inválido." }); upd.nome = n; }
  if (b.descricao !== undefined) upd.descricao = limpa(b.descricao, 400);
  if (!Object.keys(upd).length) return res.status(400).json({ erro: "Nada para salvar." });
  await db(`itens?id=eq.${enc(b.id)}`, { method: "PATCH", body: upd, prefer: "return=minimal" });
  await auditar(ctx.user.email, "item_salvar", { id: b.id, nome: atual[0].nome, ...mudancas });
  res.status(200).json({ ok: true });
}

async function itemNovo(req, res, ctx) {
  const b = corpo(req);
  const nome = limpa(b.nome, 80), preco = arred(Number(b.preco));
  if (nome.length < 2 || !precoValido(preco) || !ehId(b.categoria)) return res.status(400).json({ erro: "Preencha nome, categoria e preço." });
  const cat = await db(`categorias?id=eq.${enc(b.categoria)}&select=id`);
  if (!cat.length) return res.status(400).json({ erro: "Categoria inválida." });
  const id = "x" + Date.now().toString(36);
  await db("itens", { method: "POST", prefer: "return=minimal", body: { id, categoria: b.categoria, nome, descricao: limpa(b.descricao, 400), preco, ordem: 900 } });
  await auditar(ctx.user.email, "item_novo", { id, nome, preco });
  res.status(200).json({ ok: true, id });
}

async function config(req, res, ctx) {
  if (req.method === "POST") {
    const t = arred(Number(corpo(req).taxaEntrega));
    if (!Number.isFinite(t) || t < 0 || t > 100) return res.status(400).json({ erro: "Taxa inválida." });
    await db("config?on_conflict=chave", { method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: { chave: "taxa_entrega", valor: t } });
    await auditar(ctx.user.email, "taxa_entrega", { valor: t });
    return res.status(200).json({ ok: true });
  }
  const m = await carregarMenu({ todos: true });
  res.status(200).json({ taxaEntrega: m.taxaEntrega });
}

async function equipe(req, res, ctx) {
  if (req.method === "POST") {
    const b = corpo(req);
    const email = limpa(b.email, 120).toLowerCase();
    const role = b.role === "admin" ? "admin" : "cliente";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: "E-mail inválido." });
    if (email === ctx.user.email) return res.status(400).json({ erro: "Você não pode alterar o seu próprio acesso." });
    const r = await db(`perfis?email=eq.${enc(email)}`, { method: "PATCH", body: { role } });
    if (!r.length) return res.status(404).json({ erro: "Essa pessoa ainda não criou conta no site. Peça para ela se cadastrar primeiro." });
    await auditar(ctx.user.email, "equipe", { email, role });
    return res.status(200).json({ ok: true });
  }
  const rows = await db("perfis?role=eq.admin&select=email,nome,criado_em&order=criado_em.asc");
  res.status(200).json({ admins: rows, voce: ctx.user.email });
}

async function historico(req, res) {
  res.status(200).json({ itens: await db("auditoria?select=*&order=quando.desc&limit=60") });
}

const rotas = { resumo, pedidos, pedido_status: pedidoStatus, itens, item_salvar: itemSalvar, item_novo: itemNovo, config, equipe, historico };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ctx = await exigirAdmin(req, res);
    if (!ctx) return;
    const acao = String((req.query && req.query.a) || "");
    const rota = rotas[acao];
    if (!rota) return res.status(404).json({ erro: "Ação desconhecida." });
    const escrita = ["pedido_status", "item_salvar", "item_novo"].includes(acao) || (["config", "equipe"].includes(acao) && req.method === "POST");
    if (escrita && req.method !== "POST") return res.status(405).json({ erro: "Use POST." });
    await rota(req, res, ctx);
  } catch (e) {
    console.error("admin:", e.message);
    res.status(500).json({ erro: "Erro no servidor." });
  }
};
