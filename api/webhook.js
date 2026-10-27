// Notificação do Mercado Pago: atualiza o pedido no banco e avisa o dono (Telegram, opcional)
// uma única vez, quando o pagamento passa a "aprovado".
const crypto = require("crypto");
const { temDB, db, enc } = require("./_lib");

function assinaturaValida(req, dataId) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) return true;
  const header = String(req.headers["x-signature"] || "");
  const ts = (header.match(/ts=([^,]+)/) || [])[1];
  const v1 = (header.match(/v1=([^,]+)/) || [])[1];
  if (!ts || !v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const esperado = crypto.createHmac("sha256", segredo).update(`id:${id};request-id:${req.headers["x-request-id"] || ""};ts:${ts};`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1)); } catch { return false; }
}

async function avisar(texto) {
  const bot = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (bot && chat) {
    await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: texto }) });
  } else console.log(texto);
}

module.exports = async (req, res) => {
  const token = process.env.MP_ACCESS_TOKEN;
  const q = req.query || {};
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const dataId = String((body.data && body.data.id) || q["data.id"] || q.id || "");
  const topico = body.type || q.type || q.topic;

  if (!token || !dataId || (topico && topico !== "payment")) return res.status(200).send("ok");
  if (!assinaturaValida(req, dataId)) return res.status(401).send("assinatura inválida");

  try {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${enc(dataId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(500).send("erro ao consultar pagamento"); // o Mercado Pago tenta de novo
    const pg = await r.json();
    const ref = String(pg.external_reference || "");
    const texto = `✅ PAGAMENTO APROVADO (${pg.payment_type_id || "online"})\n\n${(pg.metadata && pg.metadata.pedido) || "Pedido " + (ref || dataId)}`;

    if (!temDB() || !ref) {
      if (pg.status === "approved") await avisar(texto);
      return res.status(200).send("ok");
    }

    const r_ = enc(ref);
    if (pg.status === "approved") {
      // só muda (e avisa) se ainda não estava pago: evita aviso duplicado
      const mudou = await db(`pedidos?ref=eq.${r_}&status=in.(aguardando_pagamento,recusado)`, {
        method: "PATCH", body: { status: "pago", pago_em: new Date().toISOString(), mp_payment_id: String(pg.id), mp_metodo: pg.payment_type_id || null },
      });
      if (mudou && mudou.length) await avisar(texto);
    } else if (pg.status === "rejected") {
      await db(`pedidos?ref=eq.${r_}&status=eq.aguardando_pagamento`, { method: "PATCH", body: { status: "recusado", mp_payment_id: String(pg.id) }, prefer: "return=minimal" });
    } else if (pg.status === "refunded" || pg.status === "cancelled" || pg.status === "charged_back") {
      await db(`pedidos?ref=eq.${r_}&status=in.(aguardando_pagamento,pago,recusado)`, { method: "PATCH", body: { status: "cancelado" }, prefer: "return=minimal" });
    }
    return res.status(200).send("ok");
  } catch (e) {
    console.error("Webhook falhou:", e);
    return res.status(500).send("erro");
  }
};
