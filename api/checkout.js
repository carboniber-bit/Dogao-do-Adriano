// Cria o pedido (grava no banco) e, no modo online, a preferência de pagamento no Mercado Pago.
// Os preços vêm SEMPRE do cardápio no servidor/banco, nunca do navegador.
const { status } = require("./_horario");
const { carregarMenu } = require("./_menu");
const { temDB, db, usuario, limpa, arred, corpo } = require("./_lib");

const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  return `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido." });

  const b = corpo(req);
  const modoZap = b.modo === "whatsapp";
  const token = process.env.MP_ACCESS_TOKEN;
  if (!modoZap && !token) return res.status(503).json({ erro: "Pagamento online ainda não está configurado." });

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

  if (!modoZap) {
    const s = status(tipo);
    if (!s.aberto) return res.status(409).json({ erro: "Fechado agora. " + s.msg });
  }

  let menu;
  try { menu = await carregarMenu(); } catch (e) { console.error("menu:", e.message); return res.status(500).json({ erro: "Cardápio indisponível. Tente de novo." }); }
  const porId = new Map(menu.itens.map((i) => [i.id, i]));

  const snapshot = [], items = [], linhas = [];
  let subtotal = 0;
  for (const it of b.itens) {
    const prod = porId.get(String(it.id));
    const q = Number(it.q);
    if (!prod || prod.encomenda || !Number.isInteger(q) || q < 1 || q > 20) {
      return res.status(400).json({ erro: "Um item do carrinho não está mais disponível. Atualize a página." });
    }
    const pao = prod.paes ? (prod.paes.includes(it.pao) ? it.pao : prod.paes[0]) : "";
    const titulo = pao ? `${prod.nome} (pão de ${pao.toLowerCase()})` : prod.nome;
    items.push({ id: prod.id, title: titulo, quantity: q, unit_price: prod.preco, currency_id: "BRL" });
    snapshot.push({ id: prod.id, nome: prod.nome, pao, q, preco: prod.preco });
    linhas.push(`${q}x ${titulo}`);
    subtotal += q * prod.preco;
  }
  subtotal = arred(subtotal);
  const taxa = tipo === "Delivery" && menu.taxaEntrega > 0 ? menu.taxaEntrega : 0;
  if (taxa > 0 && !modoZap) items.push({ id: "taxa", title: "Taxa de entrega", quantity: 1, unit_price: taxa, currency_id: "BRL" });
  const total = arred(subtotal + taxa);

  const ref = "DA" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
  const resumo = [
    `Pedido ${ref}`, ...linhas, `Total: ${brl(total)}`, `Tipo: ${tipo}`, `Nome: ${nome}`, `Telefone: ${telefone}`,
    tipo === "Delivery" ? `Endereço: ${endereco}` : null, obs ? `Obs.: ${obs}` : null,
  ].filter(Boolean).join("\n");

  // grava o pedido (se o banco estiver configurado)
  if (temDB()) {
    try {
      const u = await usuario(req);
      await db("pedidos", {
        method: "POST", prefer: "return=minimal",
        body: { ref, user_id: u ? u.id : null, nome, telefone, tipo, endereco: tipo === "Delivery" ? endereco : null, obs: obs || null,
                itens: snapshot, subtotal, taxa, total, forma: modoZap ? "whatsapp" : "online", status: modoZap ? "a_combinar" : "aguardando_pagamento" },
      });
    } catch (e) {
      console.error("não foi possível gravar o pedido:", e.message);
      return res.status(500).json({ erro: "Não foi possível registrar o pedido. Tente de novo em instantes." });
    }
  }
  if (modoZap) return res.status(200).json({ ref, total });

  const base = baseUrl(req);
  const area = telefone.length >= 12 ? telefone.slice(2, 4) : telefone.slice(0, 2);
  const numero = telefone.length >= 12 ? telefone.slice(4) : telefone.slice(2);
  const preferencia = {
    items,
    payer: { name: nome, phone: { area_code: area, number: numero } },
    external_reference: ref,
    back_urls: { success: `${base}/?pagamento=ok&ref=${ref}`, pending: `${base}/?pagamento=pendente&ref=${ref}`, failure: `${base}/?pagamento=erro&ref=${ref}` },
    auto_return: "approved",
    statement_descriptor: "DOGAO DO ADRIANO",
    notification_url: `${base}/api/webhook`,
    metadata: { pedido: resumo, ref },
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 3 },
  };

  try {
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(preferencia),
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
