// Notificação do Mercado Pago: busca o pagamento e atualiza o pedido (aviso ao dono uma única vez).
const crypto = require("crypto");
const { enc } = require("./_lib");
const { aplicar } = require("./_pagamento");

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
    await aplicar(await r.json());
    return res.status(200).send("ok");
  } catch (e) {
    console.error("Webhook falhou:", e.message);
    return res.status(500).send("erro");
  }
};
