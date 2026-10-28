// GET /api/pedido?ref=XXXX -> {status}. Usado pelo site para saber se o Pix foi pago.
// Nunca devolve dados pessoais.
const { temDB, db, enc } = require("./_lib");
const { aplicar } = require("./_pagamento");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ erro: "Método não permitido." });
  const ref = String((req.query && req.query.ref) || "");
  if (!/^[A-Z0-9]{6,24}$/.test(ref)) return res.status(400).json({ erro: "Pedido inválido." });
  if (!temDB()) return res.status(400).json({ erro: "Consulta indisponível." });
  try {
    const sel = async () => (await db(`pedidos?ref=eq.${enc(ref)}&select=status,mp_payment_id`))[0];
    let p = await sel();
    if (!p) return res.status(404).json({ erro: "Pedido não encontrado." });
    const token = process.env.MP_ACCESS_TOKEN;
    if (p.status === "aguardando_pagamento" && p.mp_payment_id && token) {
      // cobre atraso/falha do webhook
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${enc(p.mp_payment_id)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) { await aplicar(await r.json()); p = (await sel()) || p; }
      } catch (e) { console.error("pedido/consulta MP:", e.message); }
    }
    return res.status(200).json({ status: p.status });
  } catch (e) {
    console.error("pedido:", e.message);
    return res.status(500).json({ erro: "Erro ao consultar o pedido." });
  }
};
