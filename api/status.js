const { status } = require("./_horario");
const { URL_, AK, temAuth } = require("./_lib");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    Delivery: status("Delivery"),
    Retirada: status("Retirada"),
    pagamentoOnline: Boolean(process.env.MP_ACCESS_TOKEN),
    // a chave publishable foi feita para ficar no navegador; a secreta nunca sai do servidor
    auth: temAuth() ? { url: URL_, key: AK } : null,
  });
};
