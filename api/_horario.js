// Horários de atendimento (fuso America/Sao_Paulo)
// Presencial/retirada: 18:30 às 05:00, todos os dias
// Delivery: 18:30 à 01:00, exceto terças
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function agora(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  let dow = DIAS[get("weekday")];
  let m = (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10);
  if (m < 300) { dow = (dow + 6) % 7; m += 1440; } // madrugada pertence ao expediente do dia anterior
  return { dow, m };
}

function status(tipo, d) {
  if (process.env.IGNORAR_HORARIO) return { aberto: true, msg: "" }; // só para testes
  const { dow, m } = agora(d);
  const delivery = tipo === "Delivery";
  const fim = delivery ? 1500 : 1740;
  if (delivery && dow === 2) return { aberto: false, msg: "Não fazemos entregas às terças. Você pode retirar na praça." };
  if (m >= 1110 && m < fim) return { aberto: true, msg: "" };
  return {
    aberto: false,
    msg: delivery ? "O delivery funciona das 18:30 às 01:00." : "Atendemos das 18:30 às 05:00.",
  };
}

module.exports = { status };
