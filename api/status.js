const { status } = require("./_horario");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    Delivery: status("Delivery"),
    Retirada: status("Retirada"),
    pagamentoOnline: Boolean(process.env.MP_ACCESS_TOKEN),
  });
};
