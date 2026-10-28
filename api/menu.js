const { carregarMenu } = require("./_menu");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const m = await carregarMenu();
    const ativas = new Set(m.itens.map((i) => i.cat));
    res.status(200).json({
      whatsapp: m.whatsapp, taxaEntrega: m.taxaEntrega, bairros: m.bairros || [],
      categorias: m.categorias.filter((c) => ativas.has(c.id)),
      itens: m.itens.map(({ verificar, ...i }) => i),
    });
  } catch (e) {
    console.error("menu:", e.message);
    res.status(500).json({ erro: "Não foi possível carregar o cardápio." });
  }
};
