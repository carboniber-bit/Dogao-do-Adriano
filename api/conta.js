// Conta do cliente: dados do perfil e últimos pedidos.
const { temDB, db, usuario, perfilDe, limpa, enc, corpo } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!temDB()) return res.status(503).json({ erro: "Contas ainda não estão ativas." });
    const user = await usuario(req);
    if (!user) return res.status(401).json({ erro: "Faça login." });
    const perfil = await perfilDe(user);

    if (req.method === "POST") {
      const b = corpo(req);
      const upd = {};
      if (b.nome !== undefined) upd.nome = limpa(b.nome, 60);
      if (b.telefone !== undefined) upd.telefone = limpa(b.telefone, 20).replace(/\D/g, "").slice(0, 13);
      if (b.endereco !== undefined) upd.endereco = limpa(b.endereco, 200);
      if (Object.keys(upd).length) await db(`perfis?id=eq.${enc(user.id)}`, { method: "PATCH", body: upd, prefer: "return=minimal" });
      Object.assign(perfil, upd);
    } else if (req.method !== "GET") {
      return res.status(405).json({ erro: "Método não permitido." });
    }

    const pedidos = await db(`pedidos?user_id=eq.${enc(user.id)}&status=neq.aguardando_pagamento&select=ref,criado_em,tipo,total,status,forma,itens&order=criado_em.desc&limit=10`);
    res.status(200).json({
      perfil: { email: perfil.email, nome: perfil.nome || "", telefone: perfil.telefone || "", endereco: perfil.endereco || "", admin: perfil.role === "admin" },
      pedidos,
    });
  } catch (e) {
    console.error("conta:", e.message);
    res.status(500).json({ erro: "Erro ao carregar a conta." });
  }
};
