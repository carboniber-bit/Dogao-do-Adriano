// Aplica o estado de um pagamento do Mercado Pago ao pedido (usado pelo webhook e pelo /api/pedido).
const { temDB, db, enc } = require("./_lib");

async function avisar(texto) {
  const bot = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (bot && chat) {
    try {
      await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: texto }),
      });
    } catch (e) { console.error("telegram:", e.message); }
  } else console.log(texto);
}

function metodo(pg) {
  if (pg.payment_method_id === "pix") return "Pix";
  if (pg.payment_type_id === "credit_card") return "Cartão de crédito";
  if (pg.payment_type_id === "debit_card") return "Cartão de débito";
  return pg.payment_type_id || null;
}

async function aplicar(pg) {
  const ref = String((pg && pg.external_reference) || "");
  const m = metodo(pg);
  const texto = `✅ PAGAMENTO APROVADO (${m || "online"})\n\n${(pg.metadata && pg.metadata.pedido) || "Pedido " + (ref || pg.id)}`;

  if (!temDB() || !ref) {
    if (pg.status === "approved") await avisar(texto);
    return;
  }
  const r_ = enc(ref);
  if (pg.status === "approved") {
    // só avisa se a linha realmente mudou: evita aviso duplicado (webhook + polling)
    const mudou = await db(`pedidos?ref=eq.${r_}&status=in.(aguardando_pagamento,recusado)`, {
      method: "PATCH", body: { status: "pago", pago_em: new Date().toISOString(), mp_payment_id: String(pg.id), mp_metodo: m },
    });
    if (mudou && mudou.length) await avisar(texto);
  } else if (pg.status === "rejected") {
    await db(`pedidos?ref=eq.${r_}&status=eq.aguardando_pagamento`, { method: "PATCH", body: { status: "recusado", mp_payment_id: String(pg.id) }, prefer: "return=minimal" });
  } else if (pg.status === "refunded" || pg.status === "cancelled" || pg.status === "charged_back") {
    await db(`pedidos?ref=eq.${r_}&status=in.(aguardando_pagamento,pago,recusado)`, { method: "PATCH", body: { status: "cancelado" }, prefer: "return=minimal" });
  }
}

module.exports = { aplicar, avisar };
