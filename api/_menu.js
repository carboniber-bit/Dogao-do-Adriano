// Cardápio: vem do banco (editável no painel). Sem banco configurado, usa public/menu.json.
const base = require("../public/menu.json");
const { temDB, db } = require("./_lib");

async function carregarMenu({ todos = false } = {}) {
  if (!temDB()) {
    return { whatsapp: base.whatsapp, taxaEntrega: base.taxaEntrega || 0, categorias: base.categorias, itens: base.itens.map((i) => ({ ...i, ativo: true })), banco: false };
  }
  const [cats, itens, cfg] = await Promise.all([
    db("categorias?select=*&order=ordem.asc"),
    db(`itens?select=*&order=ordem.asc${todos ? "" : "&ativo=eq.true"}`),
    db("config?chave=eq.taxa_entrega&select=valor"),
  ]);
  return {
    whatsapp: base.whatsapp,
    taxaEntrega: cfg && cfg[0] ? Number(cfg[0].valor) || 0 : 0,
    categorias: cats.map((c) => ({ id: c.id, nome: c.nome })),
    itens: itens.map((i) => ({
      id: i.id, cat: i.categoria, nome: i.nome, desc: i.descricao || "", preco: Number(i.preco),
      paes: i.paes && i.paes.length ? i.paes : undefined, encomenda: i.encomenda || undefined,
      ativo: i.ativo, verificar: i.verificar,
    })),
    banco: true,
  };
}
module.exports = { carregarMenu };
