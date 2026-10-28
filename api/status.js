const { status, horarios } = require("./_horario");
const { URL_, AK, temAuth } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const cfg = await horarios();
  res.status(200).json({
    Delivery: status("Delivery", undefined, cfg),
    Retirada: status("Retirada", undefined, cfg),
    horarios: cfg, // só horários públicos (o site mostra no rodapé e no topo)
    pagamentoOnline: Boolean(process.env.MP_ACCESS_TOKEN),
    // a chave publishable foi feita para ficar no navegador; a secreta nunca sai do servidor
    auth: temAuth() ? { url: URL_, key: AK } : null,
  });
};
