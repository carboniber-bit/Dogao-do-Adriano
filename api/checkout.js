// Cria uma preferência de pagamento no Mercado Pago (Checkout Pro: Pix e cartão).
// Os preços vêm SEMPRE do menu.json no servidor, nunca do navegador.
const menu = require("../public/menu.json");
const { status } = require("./_horario");

const porId = new Map(menu.itens.map((i) => [i.id, i]));
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const arred = (n) => Math.round(n * 100) / 100;
const limpa = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido." });

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(503).json({ erro: "Pagamento online ainda não está configurado." });

  let b = req.body;
  try { if (typeof b === "string") b = JSON.parse(b); } catch { b = null; }
  if (!b || typeof b !== "object") return res.status(400).json({ erro: "Pedido inválido." });

  const nome = limpa(b.nome, 60);
  const telefone = limpa(b.telefone, 20).replace(/\D/g, "");
  const tipo = b.tipo === "Retirada" ? "Retirada" : b.tipo === "Delivery" ? "Delivery" : null;
  const endereco = limpa(b.endereco, 200);
  const obs = limpa(b.obs, 200);

  if (nome.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
  if (telefone.length < 10 || telefone.length > 13) return res.status(400).json({ erro: "Informe um telefone com DDD." });
  if (!tipo) return res.status(400).json({ erro: "Escolha delivery ou retirada." });
  if (tipo === "Delivery" && endereco.length < 6) return res.status(400).json({ erro: "Informe o endereço de entrega." });
  if (!Array.isArray(b.itens) || b.itens.length < 1 || b.itens.length > 30) return res.status(400).json({ erro: "Carrinho vazio." });

  const aberto = status(tipo);
  if (!aberto.aberto) return res.status(409).json({ erro: "Fechado agora. " + aberto.msg });

  const items = [];
  const linhas = [];
  let subtotal = 0;
  for (const it of b.itens) {
    const prod = porId.get(String(it.id));
    const q = Number(it.q);
    if (!prod || prod.encomenda || !Number.isInteger(q) || q < 1 || q > 20) {
      return res.status(400).json({ erro: "Item inválido no carrinho." });
    }
    let pao = "";
    if (prod.paes) {
      pao = prod.paes.includes(it.pao) ? it.pao : prod.paes[0];
    }
    const titulo = pao ? `${prod.nome} (pão de ${pao.toLowerCase()})` : prod.nome;
    items.push({ id: prod.id, title: titulo, quantity: q, unit_price: prod.preco, currency_id: "BRL" });
    linhas.push(`${q}x ${titulo}`);
    subtotal += q * prod.preco;
  }
  let total = subtotal;
  if (tipo === "Delivery" && menu.taxaEntrega > 0) {
    items.push({ id: "taxa", title: "Taxa de entrega", quantity: 1, unit_price: menu.taxaEntrega, currency_id: "BRL" });
    total += menu.taxaEntrega;
  }
  total = arred(total);

  const ref = "DA" + Date.now().toString(36).toUpperCase();
  const resumo = [
    `Pedido ${ref}`,
    ...linhas,
    `Total: ${brl(total)}`,
    `Tipo: ${tipo}`,
    `Nome: ${nome}`,
    `Telefone: ${telefone}`,
    tipo === "Delivery" ? `Endereço: ${endereco}` : null,
    obs ? `Obs.: ${obs}` : null,
  ].filter(Boolean).join("\n");

  const base = baseUrl(req);
  const area = telefone.length >= 12 ? telefone.slice(2, 4) : telefone.slice(0, 2);
  const numero = telefone.length >= 12 ? telefone.slice(4) : telefone.slice(2);

  const preferencia = {
    items,
    payer: { name: nome, phone: { area_code: area, number: numero } },
    external_reference: ref,
    back_urls: {
      success: `${base}/?pagamento=ok&ref=${ref}`,
      pending: `${base}/?pagamento=pendente&ref=${ref}`,
      failure: `${base}/?pagamento=erro&ref=${ref}`,
    },
    auto_return: "approved",
    statement_descriptor: "DOGAO DO ADRIANO",
    notification_url: `${base}/api/webhook`,
    metadata: { pedido: resumo, ref },
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 3 },
  };

  try {
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(preferencia),
    });
    const data = await r.json();
    if (!r.ok || !data.init_point) {
      console.error("Mercado Pago recusou a preferência:", r.status, JSON.stringify(data));
      return res.status(502).json({ erro: "Não foi possível iniciar o pagamento. Tente de novo em instantes." });
    }
    return res.status(200).json({ url: data.init_point, ref, total });
  } catch (e) {
    console.error("Falha ao falar com o Mercado Pago:", e);
    return res.status(502).json({ erro: "Não foi possível iniciar o pagamento. Tente de novo em instantes." });
  }
};
