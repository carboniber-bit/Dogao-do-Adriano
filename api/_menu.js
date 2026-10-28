// Cardápio: vem do banco (editável no painel). Sem banco configurado, usa public/menu.json.
const base = require("../public/menu.json");
const { temDB, db } = require("./_lib");

// Taxa por bairro: lista [{nome, taxa}] em config.bairros. Lista vazia = taxa única (config.taxa_entrega).
// Leitura tolerante (ignora o que for inválido); validação estrita fica em validarBairros (painel).
function lerBairros(v) {
  if (!Array.isArray(v)) return [];
  const vistos = new Set(), out = [];
  for (const b of v) {
    const nome = typeof (b && b.nome) === "string" ? b.nome.trim() : "";
    const taxa = Number(b && b.taxa);
    if (nome.length < 2 || nome.length > 40 || !Number.isFinite(taxa) || taxa < 0 || taxa > 100 || vistos.has(nome.toLowerCase())) continue;
    vistos.add(nome.toLowerCase()); out.push({ nome, taxa: Math.round(taxa * 100) / 100 });
  }
  return out.slice(0, 60);
}
function validarBairros(v) {
  if (!Array.isArray(v) || v.length > 60) return null;
  const lido = lerBairros(v);
  return lido.length === v.length ? lido : null; // qualquer linha inválida ou repetida recusa tudo
}

async function carregarMenu({ todos = false } = {}) {
  if (!temDB()) {
    return { whatsapp: base.whatsapp, taxaEntrega: base.taxaEntrega || 0, bairros: [], categorias: base.categorias, itens: base.itens.map((i) => ({ ...i, ativo: true })), banco: false };
  }
  const [cats, itens, cfg, cfgBairros] = await Promise.all([
    db("categorias?select=*&order=ordem.asc"),
    db(`itens?select=*&order=ordem.asc${todos ? "" : "&ativo=eq.true"}`),
    db("config?chave=eq.taxa_entrega&select=valor"),
    db("config?chave=eq.bairros&select=valor"),
  ]);
  return {
    whatsapp: base.whatsapp,
    taxaEntrega: cfg && cfg[0] ? Number(cfg[0].valor) || 0 : 0,
    bairros: lerBairros(cfgBairros && cfgBairros[0] && cfgBairros[0].valor),
    categorias: cats.map((c) => ({ id: c.id, nome: c.nome })),
    itens: itens.map((i) => ({
      id: i.id, cat: i.categoria, nome: i.nome, desc: i.descricao || "", preco: Number(i.preco),
      paes: i.paes && i.paes.length ? i.paes : undefined, encomenda: i.encomenda || undefined,
      ativo: i.ativo, verificar: i.verificar,
    })),
    banco: true,
  };
}
module.exports = { carregarMenu, validarBairros, lerBairros };
