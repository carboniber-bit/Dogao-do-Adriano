// Horários de atendimento (fuso America/Sao_Paulo), editáveis no painel (tabela config, chave "horarios").
// Padrão: retirada/presencial 18:30–05:00 todos os dias; delivery 18:30–01:00, exceto terças.
// Se "fecha" for menor ou igual a "abre", o expediente passa da meia-noite (a madrugada pertence ao dia em que abriu).
const { temDB, db } = require("./_lib");

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const NOME_DIA = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
const TIPOS = ["Retirada", "Delivery"];
const PADRAO = {
  Retirada: { abre: "18:30", fecha: "05:00", dias: [0, 1, 2, 3, 4, 5, 6] },
  Delivery: { abre: "18:30", fecha: "01:00", dias: [0, 1, 3, 4, 5, 6] },
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const min = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

function valido(x) {
  return Boolean(x) && typeof x.abre === "string" && typeof x.fecha === "string" && HHMM.test(x.abre) && HHMM.test(x.fecha) && x.abre !== x.fecha
    && Array.isArray(x.dias) && x.dias.length <= 7 && x.dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}
const limpo = (x) => ({ abre: x.abre, fecha: x.fecha, dias: [...new Set(x.dias)].sort((a, b) => a - b) });
// leitura tolerante: o que estiver inválido volta ao padrão
function normalizar(c) {
  const out = {};
  for (const t of TIPOS) out[t] = c && valido(c[t]) ? limpo(c[t]) : { ...PADRAO[t], dias: [...PADRAO[t].dias] };
  return out;
}
// validação estrita (painel): devolve o objeto limpo ou null
function validar(c) { return c && TIPOS.every((t) => valido(c[t])) ? Object.fromEntries(TIPOS.map((t) => [t, limpo(c[t])])) : null; }

let cache = { v: null, ate: 0 };
const limparCache = () => { cache = { v: null, ate: 0 }; };
async function horarios() {
  if (!temDB()) return normalizar(null);
  if (cache.v && cache.ate > Date.now()) return cache.v;
  try {
    const r = await db("config?chave=eq.horarios&select=valor");
    cache = { v: normalizar(r && r[0] && r[0].valor), ate: Date.now() + 15000 };
  } catch (e) { console.error("horarios:", e.message); return cache.v || normalizar(null); }
  return cache.v;
}

function agora(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { dow: DIAS[get("weekday")], m: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10) };
}

function status(tipo, d, cfg) {
  if (process.env.IGNORAR_HORARIO) return { aberto: true, msg: "" }; // só para testes
  const h = (cfg || PADRAO)[tipo] || PADRAO[tipo];
  const a = min(h.abre); let f = min(h.fecha);
  const cruza = f <= a; if (cruza) f += 1440;
  const { dow, m } = agora(d);
  const ontem = (dow + 6) % 7;
  const hoje = h.dias.includes(dow) && m >= a && m < Math.min(f, 1440);
  const madrugada = cruza && h.dias.includes(ontem) && m < f - 1440;
  if (hoje || madrugada) return { aberto: true, msg: "" };
  const diaDoTurno = cruza && m < f - 1440 ? ontem : dow; // a madrugada conta como o dia anterior
  const delivery = tipo === "Delivery";
  if (!h.dias.includes(diaDoTurno)) {
    return { aberto: false, msg: delivery ? `Não fazemos entregas às ${NOME_DIA[diaDoTurno]}. Você pode retirar na praça.` : `Não atendemos às ${NOME_DIA[diaDoTurno]}.` };
  }
  return { aberto: false, msg: delivery ? `O delivery funciona das ${h.abre} às ${h.fecha}.` : `Atendemos das ${h.abre} às ${h.fecha}.` };
}

module.exports = { status, horarios, validar, limparCache, PADRAO, NOME_DIA };
