// Cria o pedido (grava no banco) e, no modo online, o pagamento no Mercado Pago:
// modo "pix" -> pagamento Pix (QR code + copia e cola, dentro do site);
// sem modo   -> Checkout Pro (cartão); modo "whatsapp" -> combina pelo WhatsApp.
// Os preços vêm SEMPRE do cardápio no servidor/banco, nunca do navegador.
const { status, horarios } = require("./_horario");
const { avisar } = require("./_pagamento");
const { carregarMenu } = require("./_menu");
const { temDB, db, usuario, limpa, arred, corpo, enc } = require("./_lib");

const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  return `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

// Pix pela API de Pagamentos do Mercado Pago. O e-mail só vai ao Mercado Pago (não é gravado nem logado).
async function criarPix({ res, base, token, ref, nome, email, total, items, resumo }) {
  const partes = nome.split(/\s+/).filter(Boolean);
  const primeiro = partes[0] || nome;
  const resto = partes.slice(1).join(" ") || primeiro;
  const corpoMp = {
    transaction_amount: total,
    description: `Dogão do Adriano ${ref}`,
    payment_method_id: "pix",
    date_of_expiration: new Date(Date.now() + 30 * 60000 - 3 * 3600000).toISOString().replace("Z", "-03:00"),
    external_reference: ref,
    notification_url: `${base}/api/webhook`,
    payer: { email, first_name: primeiro, last_name: resto },
    additional_info: { items: items.map((i) => ({ id: i.id, title: i.title, quantity: i.quantity, unit_price: i.unit_price })) },
    metadata: { pedido: resumo, ref },
  };

  const falhou = async () => {
    if (temDB()) { try { await db(`pedidos?ref=eq.${enc(ref)}`, { method: "PATCH", body: { status: "cancelado" }, prefer: "return=minimal" }); } catch (e) { console.error("cancelar pedido:", e.message); } }
    return res.status(502).json({ erro: "Pix indisponível no momento. Pague com cartão ou combine pelo WhatsApp." });
  };

  try {
    const r = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": ref },
      body: JSON.stringify(corpoMp),
    });
    const data = await r.json().catch(() => ({}));
    const td = data && data.point_of_interaction && data.point_of_interaction.transaction_data;
    if (!r.ok || !td || !td.qr_code) {
      // log para o dono (sem token nem e-mail). Erro comum: conta sem chave Pix cadastrada.
      console.error("Mercado Pago recusou o Pix:", r.status, JSON.stringify(data).split(email).join("[email]").slice(0, 800));
      return falhou();
    }
    if (temDB()) {
      try { await db(`pedidos?ref=eq.${enc(ref)}`, { method: "PATCH", body: { mp_payment_id: String(data.id), mp_metodo: "Pix" }, prefer: "return=minimal" }); }
      catch (e) { console.error("gravar pagamento Pix:", e.message); }
    }
    return res.status(200).json({ ref, total, pix: { id: String(data.id), copia: td.qr_code, qr: td.qr_code_base64, expira: data.date_of_expiration || corpoMp.date_of_expiration, url: td.ticket_url } });
  } catch (e) {
    console.error("Falha ao falar com o Mercado Pago (Pix):", e.message);
    return falhou();
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido." });

  const b = corpo(req);
  const modoZap = b.modo === "whatsapp";
  const modoPix = b.modo === "pix";
  const token = process.env.MP_ACCESS_TOKEN;
  if (!modoZap && !token) return res.status(503).json({ erro: "Pagamento online ainda não está configurado." });

  const nome = limpa(b.nome, 60);
  const telefone = limpa(b.telefone, 20).replace(/\D/g, "");
  const tipo = b.tipo === "Retirada" ? "Retirada" : b.tipo === "Delivery" ? "Delivery" : null;
  const endereco = limpa(b.endereco, 200);
  const obs = limpa(b.obs, 200);
  const email = limpa(b.email, 120);

  if (nome.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
  if (telefone.length < 10 || telefone.length > 13) return res.status(400).json({ erro: "Informe um telefone com DDD." });
  if (!tipo) return res.status(400).json({ erro: "Escolha delivery ou retirada." });
  if (tipo === "Delivery" && endereco.length < 6) return res.status(400).json({ erro: "Informe o endereço de entrega." });
  if (modoPix && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: "Informe um e-mail válido para o Pix." });
  if (!Array.isArray(b.itens) || b.itens.length < 1 || b.itens.length > 30) return res.status(400).json({ erro: "Carrinho vazio." });

  if (!modoZap) {
    const s = status(tipo, undefined, await horarios());
    if (!s.aberto) return res.status(409).json({ erro: "Fechado agora. " + s.msg });
  }

  let menu;
  try { menu = await carregarMenu(); } catch (e) { console.error("menu:", e.message); return res.status(500).json({ erro: "Cardápio indisponível. Tente de novo." }); }
  const porId = new Map(menu.itens.map((i) => [i.id, i]));

  // Adicionais (categoria "adicionais") só existem DENTRO de um lanche: it.adds = [ids], cada um no máximo 1x por lanche.
  // Bebidas e itens de encomenda não aceitam adicionais. O preço de cada linha é recalculado aqui.
  const CAT_ADIC = "adicionais", SEM_ADIC = new Set([CAT_ADIC, "bebidas"]);
  const indisponivel = () => res.status(400).json({ erro: "Um item do carrinho não está mais disponível. Atualize a página." });
  const snapshot = [], items = [], linhas = [];
  let subtotal = 0;
  for (const it of b.itens) {
    const prod = porId.get(String(it.id));
    const q = Number(it.q);
    if (!prod || prod.encomenda || prod.cat === CAT_ADIC || !Number.isInteger(q) || q < 1 || q > 20) return indisponivel();
    if (it.adds !== undefined && !Array.isArray(it.adds)) return indisponivel();
    const idsAdd = (it.adds || []).map(String);
    let adds = [];
    if (idsAdd.length) {
      if (SEM_ADIC.has(prod.cat) || idsAdd.length > 8 || new Set(idsAdd).size !== idsAdd.length) return indisponivel();
      adds = idsAdd.map((id) => porId.get(id));
      if (adds.some((a) => !a || a.cat !== CAT_ADIC || a.encomenda)) return indisponivel();
    }
    const pao = prod.paes ? (prod.paes.includes(it.pao) ? it.pao : prod.paes[0]) : "";
    const titulo = (pao ? `${prod.nome} (pão de ${pao.toLowerCase()})` : prod.nome) + adds.map((a) => ` + ${a.nome}`).join("");
    const unit = arred(prod.preco + adds.reduce((s, a) => s + a.preco, 0));
    items.push({ id: prod.id, title: titulo, quantity: q, unit_price: unit, currency_id: "BRL" });
    snapshot.push({ id: prod.id, nome: prod.nome, pao, q, preco: unit, base: prod.preco, adds: adds.map((a) => ({ id: a.id, nome: a.nome, preco: a.preco })) });
    linhas.push(`${q}x ${titulo}`);
    subtotal += q * unit;
  }
  subtotal = arred(subtotal);
  // taxa: por bairro (se o painel tiver lista de bairros) ou única; sempre calculada aqui, nunca vinda do navegador
  let taxa = 0, bairroNome = "";
  if (tipo === "Delivery") {
    const lista = menu.bairros || [];
    if (lista.length) {
      const escolhido = String(b.bairro ?? "");
      if (escolhido === "__outro") { taxa = menu.taxaEntrega > 0 ? menu.taxaEntrega : 0; bairroNome = "Outro bairro"; }
      else {
        const achado = lista.find((x) => x.nome === escolhido);
        if (!achado) return res.status(400).json({ erro: "Escolha o bairro da entrega." });
        taxa = achado.taxa; bairroNome = achado.nome;
      }
    } else taxa = menu.taxaEntrega > 0 ? menu.taxaEntrega : 0;
  }
  const enderecoFinal = tipo === "Delivery" && bairroNome ? `${endereco} (bairro: ${bairroNome})` : endereco;
  if (taxa > 0 && !modoZap) items.push({ id: "taxa", title: bairroNome ? `Taxa de entrega (${bairroNome})` : "Taxa de entrega", quantity: 1, unit_price: taxa, currency_id: "BRL" });
  const total = arred(subtotal + taxa);

  const ref = "DA" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
  const resumo = [
    `Pedido ${ref}`, ...linhas, `Total: ${brl(total)}`, `Tipo: ${tipo}`, `Nome: ${nome}`, `Telefone: ${telefone}`,
    tipo === "Delivery" ? `Endereço: ${enderecoFinal}` : null, obs ? `Obs.: ${obs}` : null,
  ].filter(Boolean).join("\n");

  // grava o pedido (se o banco estiver configurado)
  if (temDB()) {
    try {
      const u = await usuario(req);
      await db("pedidos", {
        method: "POST", prefer: "return=minimal",
        body: { ref, user_id: u ? u.id : null, nome, telefone, tipo, endereco: tipo === "Delivery" ? enderecoFinal : null, obs: obs || null,
                itens: snapshot, subtotal, taxa, total, forma: modoZap ? "whatsapp" : "online", status: modoZap ? "a_combinar" : "aguardando_pagamento" },
      });
    } catch (e) {
      console.error("não foi possível gravar o pedido:", e.message);
      return res.status(500).json({ erro: "Não foi possível registrar o pedido. Tente de novo em instantes." });
    }
  }
  if (modoZap) {
    // avisa o dono (Telegram): pedido para pagar na entrega/retirada, ainda não pago
    try { await avisar(`🕒 NOVO PEDIDO (pagar na entrega/retirada)\n\n${resumo}`); } catch (e) { console.error("aviso:", e.message); }
    return res.status(200).json({ ref, total });
  }

  if (modoPix) return criarPix({ res, base: baseUrl(req), token, ref, nome, email, total, items, resumo });

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
