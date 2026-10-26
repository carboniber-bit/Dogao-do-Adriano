// Recebe a notificação do Mercado Pago. Quando o pagamento é aprovado,
// avisa o dono no Telegram (opcional: TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID).
const crypto = require("crypto");

function assinaturaValida(req, dataId) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) return true; // verificação opcional
  const header = String(req.headers["x-signature"] || "");
  const ts = (header.match(/ts=([^,]+)/) || [])[1];
  const v1 = (header.match(/v1=([^,]+)/) || [])[1];
  if (!ts || !v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifesto = `id:${id};request-id:${req.headers["x-request-id"] || ""};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", segredo).update(manifesto).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1)); } catch { return false; }
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
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(500).send("erro ao consultar pagamento"); // o Mercado Pago tenta de novo
    const pg = await r.json();

    if (pg.status === "approved") {
      const bot = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      const texto = `✅ PAGAMENTO APROVADO (${pg.payment_type_id || "online"})\n\n${(pg.metadata && pg.metadata.pedido) || "Pedido " + (pg.external_reference || dataId)}`;
      if (bot && chat) {
        await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: texto }),
        });
      } else {
        console.log(texto);
      }
    }
    return res.status(200).send("ok");
  } catch (e) {
    console.error("Webhook falhou:", e);
    return res.status(500).send("erro");
  }
};
