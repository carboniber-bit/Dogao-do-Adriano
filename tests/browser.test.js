// Teste no navegador (Playwright) com Supabase e Mercado Pago simulados. Rodar: node tests/browser.test.js
// Opcional: FOTOS=1 salva capturas de tela em tests/fotos/
const http = require("http"), fs = require("fs"), path = require("path");
const assert = require("node:assert/strict");
const h = require("./harness");
const { est, api, aprovar, definirStatus } = h;
const { chromium } = require("playwright");

const PUBLIC = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };
const rotas = { checkout: api("checkout.js"), pedido: api("pedido.js"), webhook: api("webhook.js"), conta: api("conta.js"), admin: api("admin.js"), status: api("status.js"), menu: api("menu.js") };

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/api/")) {
    const fn = rotas[u.pathname.slice(5)];
    if (!fn) { res.writeHead(404); return res.end(); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const txt = Buffer.concat(chunks).toString();
    let body; try { body = txt ? JSON.parse(txt) : undefined; } catch { body = txt; }
    const r = { method: req.method, headers: req.headers, query: Object.fromEntries(u.searchParams), body };
    const hdrs = {}; let code = 200;
    const o = { setHeader: (k, v) => { hdrs[k] = v; }, status(c) { code = c; return this; },
      json(x) { res.writeHead(code, { "Content-Type": "application/json", ...hdrs }); res.end(JSON.stringify(x)); },
      send(x) { res.writeHead(code, hdrs); res.end(String(x)); } };
    try { await fn(r, o); } catch (e) { console.error(e); res.writeHead(500); res.end(); }
    return;
  }
  let f = path.join(PUBLIC, u.pathname); if (f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(d); });
});

let ok = 0;
const passo = async (nome, fn) => { try { await fn(); ok++; console.log("  ✓", nome); } catch (e) { console.log("  ✗", nome, "\n    ", e.message.split("\n").slice(0, 6).join("\n     ")); process.exitCode = 1; } };
const FOTOS = process.env.FOTOS ? path.join(__dirname, "fotos") : null; if (FOTOS) fs.mkdirSync(FOTOS, { recursive: true });

async function novaPagina(browser, base, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ["clipboard-read", "clipboard-write"], ...opts });
  const page = await ctx.newPage();
  const reqs = []; page.on("request", (r) => reqs.push(r.method() + " " + r.url()));
  const erros = []; page.on("pageerror", (e) => erros.push(e.message));
  // tudo que não é local é bloqueado/simulado (fontes do Google, Supabase Auth, Mercado Pago, WhatsApp)
  await ctx.route((u) => !u.href.startsWith(base), async (route) => {
    const u = route.request().url();
    if (u.includes("/auth/v1/token?grant_type=password")) return route.fulfill({ json: { access_token: "tok-cliente", refresh_token: "r", expires_in: 3600, user: { email: "cliente@teste.com" } } });
    if (u.includes("mp.test") || u.includes("wa.me")) return route.fulfill({ contentType: "text/html", body: "<title>externo</title>externo" });
    return route.abort();
  });
  return { ctx, page, reqs, erros };
}
const montarPedido = async (page, { email = "maria@exemplo.com" } = {}) => {
  await page.goto("/"); await page.locator("[data-add]").first().waitFor();
  await page.locator("[data-add]").first().click(); // Dogão Tradicional (R$ 18); abre a janela de adicionais
  await page.locator("#dlgAdd[open]").waitFor(); await page.click("#addOk");   // sem adicionais
  await page.click("#openCart");
  await page.fill("#nome", "Maria da Silva"); await page.fill("#tel", "11999991234"); await page.fill("#end", "Rua das Flores, 123");
  if (email !== null) await page.fill("#email", email);
};
const esperar = async (cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error("tempo esgotado"); };
// compara com a largura configurada do aparelho (innerWidth cresce quando algo transborda, então não serve)
const semRolagemHorizontal = (page) => page.evaluate((w) => document.documentElement.scrollWidth <= w && document.body.scrollWidth <= w, page.viewportSize().width);

(async () => {
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://localhost:${servidor.address().port}`;
  const browser = await chromium.launch();
  const mk = (opts) => novaPagina(browser, base, { baseURL: base, ...opts });
  console.log("Teste de navegador —", base);

  // ===== Fluxo principal em 390 px, tema claro =====
  const A = await mk(); const page = A.page;
  let refAtual;
  await passo("carrinho: campo e-mail, botões Pix/cartão/WhatsApp e rodapé novos", async () => {
    await montarPedido(page, { email: null });
    assert.equal(await page.locator("#email").getAttribute("type"), "email");
    assert.equal(await page.locator("#email").getAttribute("autocomplete"), "email");
    assert.match(await page.locator('label[for="email"]').innerText(), /E-mail \(para o Pix\)/);
    assert.equal(await page.innerText("#pix"), "Pagar com Pix");
    assert.equal(await page.innerText("#pagar"), "Pagar com cartão (Mercado Pago)");
    assert.match(await page.innerText("#zap"), /WhatsApp/);
    assert.match(await page.innerText(".fine"), /Pix e cartão processados pelo Mercado Pago/);
    assert.equal(await page.locator("#pix").isEnabled(), true);
    assert.equal(await page.locator("#pagar").isEnabled(), true);
    assert.ok(await semRolagemHorizontal(page), "rolagem horizontal com a gaveta aberta");
    if (FOTOS) await page.screenshot({ path: FOTOS + "/1-carrinho-390.png" });
  });
  await passo("Pix exige e-mail válido no navegador (sem chamar a API)", async () => {
    const antes = A.reqs.filter((r) => r.includes("/api/checkout")).length;
    await page.click("#pix");
    assert.equal(await page.innerText("#erro"), "Informe um e-mail válido para o Pix.");
    await page.fill("#email", "errado@"); await page.click("#pix");
    assert.equal(await page.innerText("#erro"), "Informe um e-mail válido para o Pix.");
    assert.equal(A.reqs.filter((r) => r.includes("/api/checkout")).length, antes);
    await page.fill("#email", "maria@exemplo.com");
    assert.equal(await page.locator("#erro").isHidden(), true);
  });
  await passo("Pagar com Pix: janela com QR, código, contagem regressiva e status", async () => {
    await page.click("#pix");
    await page.locator("#dlgPix[open]").waitFor();
    refAtual = est.tabelas.pedidos.at(-1).ref;
    const src = await page.getAttribute("#pixQr", "src");
    assert.match(src, /^data:image\/png;base64,/);
    assert.equal(await page.getAttribute("#pixQr", "alt"), "QR code do Pix");
    assert.equal(await page.locator("#pixQr").evaluate((i) => i.complete && i.naturalWidth > 0), true);
    const copia = await page.inputValue("#pixCopia"); assert.match(copia, /^000201/);
    assert.match(await page.innerText("#pixTempo"), /^(29|30):\d\d$/);
    assert.equal(await page.innerText("#pixStatus"), "Aguardando pagamento…");
    assert.equal(await page.getAttribute("#pixStatus", "aria-live"), "polite");
    assert.match(await page.innerText("#pixValor"), /24,00/); // R$ 18 + taxa R$ 6
    assert.match(await page.innerText("#pixDica"), /No celular: toque em Copiar código, abra o app do seu banco e use Pix > Pix Copia e Cola\./);
    assert.equal(await page.evaluate(() => document.activeElement.id), "dlgPix", "foco no dialog");
    assert.ok(await semRolagemHorizontal(page), "rolagem horizontal com o Pix aberto");
    const caixa = await page.locator("#dlgPix").boundingBox(); assert.ok(caixa.width <= 390 && caixa.x >= 0, JSON.stringify(caixa));
    for (const sel of ["#pixCopiar", "#pixFechar"]) assert.ok((await page.locator(sel).boundingBox()).height >= 44, sel + " < 44px");
    if (FOTOS) await page.screenshot({ path: FOTOS + "/2-pix-390-claro.png" });
    assert.equal(est.tabelas.pedidos.at(-1).status, "aguardando_pagamento");
  });
  await passo("contagem regressiva anda", async () => {
    const t1 = await page.innerText("#pixTempo"); await page.waitForTimeout(2300);
    assert.notEqual(await page.innerText("#pixTempo"), t1);
  });
  await passo("Copiar código Pix coloca o código na área de transferência", async () => {
    await page.click("#pixCopiar");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.inputValue("#pixCopia"));
    assert.match(await page.innerText("#pixCopiar"), /copiado/);
  });
  await passo("Copiar: se a área de transferência falhar, o código fica selecionado", async () => {
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("negado")) }, configurable: true }); });
    await page.click("#pixCopiar");
    const sel = await page.evaluate(() => { const e = document.getElementById("pixCopia"); return e.value.slice(e.selectionStart, e.selectionEnd); });
    assert.equal(sel, await page.inputValue("#pixCopia"));
  });
  await passo("polling: consulta /api/pedido a cada ~4 s sem trazer dados pessoais", async () => {
    const n0 = A.reqs.filter((r) => r.includes("/api/pedido?ref=")).length;
    await page.waitForTimeout(8500);
    const n1 = A.reqs.filter((r) => r.includes("/api/pedido?ref=")).length;
    assert.ok(n1 - n0 >= 2 && n1 - n0 <= 3, "consultas em 8,5 s: " + (n1 - n0));
  });
  await passo("pagamento aprovado: fecha a janela do Pix, mostra 'Pagamento aprovado' e esvazia o carrinho", async () => {
    aprovar(est.tabelas.pedidos.at(-1).mp_payment_id);
    await page.locator("#resultado[open]").waitFor({ timeout: 9000 });
    assert.equal(await page.locator("#dlgPix").evaluate((d) => d.open), false);
    assert.equal(await page.innerText("#resTitulo"), "Pagamento aprovado! 🎉");
    assert.match(await page.innerText("#resTexto"), new RegExp(refAtual));
    assert.match(await page.innerText("#resPedido"), new RegExp(`Pedido ${refAtual}`));
    assert.equal(await page.innerText("#resZap"), "Enviar detalhes ao Adriano no WhatsApp");
    assert.match(await page.getAttribute("#resZap", "href"), /^https:\/\/wa\.me\/5511990173256\?text=/);
    assert.equal(await page.innerText("#count"), "0");
    assert.equal(await page.evaluate(() => localStorage.getItem("dogao_cart")), "[]");
    assert.equal(await page.evaluate(() => localStorage.getItem("dogao_pedido")), null);
    assert.equal(est.telegram.length, 1);
    if (FOTOS) await page.screenshot({ path: FOTOS + "/3-aprovado-390.png" });
  });
  await passo("sem erros de JavaScript no fluxo", async () => assert.deepEqual(A.erros, []));
  await A.ctx.close();

  // ===== Esc fecha e interrompe o polling; expiração; recusado; novo código =====
  const B = await mk(); const pb = B.page; const nPedidos = est.tabelas.pedidos.length;
  await passo("Esc fecha a janela do Pix e para o polling", async () => {
    await montarPedido(pb); await pb.click("#pix"); await pb.locator("#dlgPix[open]").waitFor();
    await pb.keyboard.press("Escape");
    assert.equal(await pb.locator("#dlgPix").evaluate((d) => d.open), false);
    await pb.waitForTimeout(500);
    const n0 = B.reqs.filter((r) => r.includes("/api/pedido?ref=")).length;
    await pb.waitForTimeout(5000);
    assert.equal(B.reqs.filter((r) => r.includes("/api/pedido?ref=")).length, n0, "continuou consultando após fechar");
    assert.equal(await pb.locator("#drawer").evaluate((d) => d.classList.contains("on")), true, "Esc no Pix não deve fechar a gaveta");
  });
  await passo("pagamento recusado/cancelado: 'Nada foi cobrado' + botão para tentar de novo", async () => {
    await pb.click("#pix"); await pb.locator("#dlgPix[open]").waitFor();
    definirStatus(est.tabelas.pedidos.at(-1).mp_payment_id, "cancelled");
    await pb.waitForFunction(() => /Nada foi cobrado/.test(document.getElementById("pixStatus").textContent), null, { timeout: 9000 });
    assert.equal(await pb.innerText("#pixStatus"), "Pagamento não concluído. Nada foi cobrado. Tente de novo.");
    assert.equal(await pb.locator("#pixNovo").isVisible(), true);
    await pb.click("#pixNovo");
    await pb.waitForFunction(() => document.getElementById("dlgPix").open && /Aguardando/.test(document.getElementById("pixStatus").textContent));
    assert.equal(est.tabelas.pedidos.length, nPedidos + 3); // 1º Pix, 2º Pix (cancelado) e o novo código
    assert.equal(await pb.locator("#pixNovo").isHidden(), true);
  });
  await pb.keyboard.press("Escape"); await B.ctx.close();

  const C = await mk();
  await passo("código expirado: 'O código expirou. Gere um novo.' e geração de outro", async () => {
    await C.page.clock.install();
    await montarPedido(C.page); await C.page.click("#pix"); await C.page.locator("#dlgPix[open]").waitFor();
    const n = est.tabelas.pedidos.length;
    await C.page.clock.fastForward("31:00");
    await esperar(async () => /expirou/.test(await C.page.innerText("#pixStatus"))); // (com o relógio falso, waitForFunction não anda)
    assert.equal(await C.page.innerText("#pixStatus"), "O código expirou. Gere um novo.");
    assert.equal(await C.page.innerText("#pixTempo"), "00:00");
    assert.equal(await C.page.locator("#pixCorpo").isHidden(), true);
    const codigoAntigo = await C.page.inputValue("#pixCopia");
    await C.page.click("#pixNovo");
    await esperar(async () => est.tabelas.pedidos.length === n + 1);
    // (o relógio do navegador está 31 min adiantado em relação ao servidor de teste, então não olhamos o status depois daqui)
    const novo = est.tabelas.pedidos.at(-1);
    assert.equal(novo.status, "aguardando_pagamento"); assert.equal(novo.mp_metodo, "Pix");
    await esperar(async () => (await C.page.inputValue("#pixCopia")) !== codigoAntigo);
    assert.match(await C.page.inputValue("#pixCopia"), /^000201/);
  });
  await C.ctx.close();

  // ===== modo escuro =====
  const D = await mk({ colorScheme: "dark" });
  await passo("modo escuro: janela do Pix legível, QR em fundo branco, sem rolagem horizontal", async () => {
    await montarPedido(D.page); await D.page.click("#pix"); await D.page.locator("#dlgPix[open]").waitFor();
    const cores = await D.page.evaluate(() => { const c = (s, p) => getComputedStyle(document.querySelector(s))[p]; return { dlg: c("#dlgPix", "backgroundColor"), txt: c("#dlgPix", "color"), qr: c("#pixQr", "backgroundColor"), valor: c("#pixValor", "color") }; });
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    assert.ok(lum(cores.dlg) < 0.25, "fundo escuro: " + cores.dlg);
    assert.ok(lum(cores.txt) > 0.7, "texto claro: " + cores.txt);
    assert.ok(lum(cores.valor) > 0.5, "valor legível: " + cores.valor);
    assert.ok(lum(cores.qr) > 0.95, "QR sobre fundo branco: " + cores.qr);
    assert.ok(await semRolagemHorizontal(D.page));
    if (FOTOS) await D.page.screenshot({ path: FOTOS + "/4-pix-390-escuro.png" });
  });
  await D.ctx.close();

  // ===== desktop =====
  const E = await mk({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  await passo("desktop: instrução para escanear o QR code", async () => {
    await montarPedido(E.page); await E.page.click("#pix"); await E.page.locator("#dlgPix[open]").waitFor();
    assert.match(await E.page.innerText("#pixDica"), /escaneie o QR code/);
    if (FOTOS) await E.page.screenshot({ path: FOTOS + "/5-pix-desktop.png" });
  });
  await E.ctx.close();

  // ===== Pix indisponível =====
  const F = await mk();
  await passo("Pix indisponível: mensagem amigável em #erro e nenhuma janela", async () => {
    est.mp.falhar = { status: 400, corpo: { message: "Collector user without key enabled for QR render" } };
    const orig = console.error; console.error = () => {};
    try { await montarPedido(F.page); await F.page.click("#pix"); await F.page.waitForFunction(() => !document.getElementById("erro").hidden); } finally { console.error = orig; est.mp.falhar = null; }
    assert.equal(await F.page.innerText("#erro"), "Pix indisponível no momento. Pague com cartão ou combine pelo WhatsApp.");
    assert.equal(await F.page.locator("#dlgPix").evaluate((d) => d.open), false);
    assert.equal(await F.page.locator("#pix").isEnabled(), true);
    assert.equal(await F.page.innerText("#pix"), "Pagar com Pix");
  });
  await F.ctx.close();

  // ===== Regressão: cartão, WhatsApp, login e Minha conta, painel =====
  const G = await mk();
  await passo("regressão: cartão segue para o Checkout Pro (sem e-mail)", async () => {
    await montarPedido(G.page, { email: null });
    const resp = G.page.waitForRequest((r) => r.url().includes("mp.test/checkout/pref-1"));
    await G.page.click("#pagar"); await resp;
    const corpo = est.tabelas.pedidos.at(-1);
    assert.equal(corpo.status, "aguardando_pagamento"); assert.equal(corpo.forma, "online");
    assert.equal(est.mp.ultimaPreferencia.external_reference, corpo.ref);
  });
  const H = await mk();
  await passo("regressão: WhatsApp registra o pedido, abre wa.me e limpa o carrinho", async () => {
    await montarPedido(H.page, { email: null });
    const [popup] = await Promise.all([H.ctx.waitForEvent("page"), H.page.click("#zap")]);
    await popup.waitForURL(/wa\.me/, { timeout: 8000 }).catch(() => {});
    assert.match(popup.url(), /wa\.me\/\d+\?text=/);
    const p = est.tabelas.pedidos.at(-1); assert.equal(p.forma, "whatsapp"); assert.equal(p.status, "a_combinar");
    await H.page.waitForFunction(() => document.getElementById("count").textContent === "0");
  });
  await H.ctx.close();
  const I = await mk();
  await passo("regressão: login, e-mail preenchido no carrinho e 'Minha conta'", async () => {
    await I.page.goto("/"); await I.page.locator("[data-add]").first().waitFor();
    await I.page.click("#openConta"); await I.page.fill("#lgEmail", "cliente@teste.com"); await I.page.fill("#lgSenha", "senha12345");
    await I.page.click("#lgOk"); await I.page.waitForFunction(() => /Cliente/.test(document.getElementById("openConta").textContent));
    await I.page.click("[data-add]"); await I.page.locator("#dlgAdd[open]").waitFor(); await I.page.click("#addOk"); await I.page.click("#openCart");
    assert.equal(await I.page.inputValue("#email"), "cliente@teste.com");
    assert.equal(await I.page.inputValue("#nome"), "Cliente Logado");
    await I.page.keyboard.press("Escape"); await I.page.click("#openConta");
    await I.page.locator("#dlgConta[open]").waitFor();
    assert.equal(await I.page.innerText("#contaEmail"), "cliente@teste.com");
    // Pix logado: o pedido leva o user_id e aparece em "Minha conta" depois de pago
    await I.page.keyboard.press("Escape"); await I.page.click("#openCart"); await I.page.fill("#tel", "11999991234"); await I.page.fill("#end", "Rua das Flores, 123");
    await I.page.click("#pix"); await I.page.locator("#dlgPix[open]").waitFor();
    assert.equal(est.tabelas.pedidos.at(-1).user_id, "u-cliente");
  });
  await I.ctx.close();
  const J = await mk();
  await passo("regressão: painel /admin lista o pedido Pix pago ('pago online (Pix)') e escapa HTML", async () => {
    const pago = est.tabelas.pedidos.find((p) => p.status === "pago");
    pago.nome = '<img src=x onerror="window.__xss=1">'; pago.obs = "<b>negrito</b>";
    await J.ctx.addInitScript(() => localStorage.setItem("dogao_auth", JSON.stringify({ access_token: "tok-admin", refresh_token: "r", exp: Date.now() + 3600e3, email: "admin@teste.com" })));
    await J.page.goto("/admin/");
    await J.page.click('[data-t="pedidos"]');
    await J.page.waitForFunction(() => /pago online \(Pix\)/.test(document.body.innerText), null, { timeout: 8000 });
    assert.equal(await J.page.evaluate(() => window.__xss), undefined);
    assert.deepEqual(J.erros, []);
  });
  await J.ctx.close();

  const K = await mk();
  await passo("painel: alerta (banner, título e som) quando chega pedido novo", async () => {
    await K.ctx.addInitScript(() => {
      localStorage.setItem("dogao_auth", JSON.stringify({ access_token: "tok-admin", refresh_token: "r", exp: Date.now() + 3600e3, email: "admin@teste.com" }));
      window.__bipes = 0; const AC = window.AudioContext;
      window.AudioContext = class extends AC { createOscillator() { window.__bipes++; return super.createOscillator(); } };
    });
    await K.page.goto("/admin/"); await K.page.locator("#app:not([hidden])").waitFor();
    assert.equal(await K.page.locator("#alerta").isHidden(), true, "sem alerta na primeira leitura");
    await K.page.click("#som");
    assert.equal(await K.page.innerText("#som"), "🔔 Som ligado");
    assert.ok(await K.page.evaluate(() => window.__bipes) >= 3, "som de teste ao ligar");
    const antes = await K.page.evaluate(() => window.__bipes);
    est.tabelas.pedidos.push({ id: "00000000-0000-4000-8000-000000000001", ref: "DANOVOPEDIDO1", nome: "Novo Cliente", telefone: "11999990000", tipo: "Retirada", endereco: null, obs: null, itens: [{ id: "agua", nome: "Água", pao: "", q: 1, preco: 5 }], subtotal: 5, taxa: 0, total: 5, forma: "whatsapp", status: "a_combinar", criado_em: new Date().toISOString() });
    await K.page.locator("#alerta:not([hidden])").waitFor({ timeout: 20000 });
    assert.match(await K.page.innerText("#alertaTxt"), /Chegou 1 pedido novo/);
    assert.ok(await K.page.evaluate(() => window.__bipes) > antes, "tocou o som");
    await K.page.waitForFunction(() => /Novo pedido!/.test(document.title), null, { timeout: 4000 });
    await K.page.click("#alertaVer");
    assert.equal(await K.page.locator("#alerta").isHidden(), true);
    await K.page.waitForFunction(() => /Novo Cliente/.test(document.getElementById("listaPedidos").innerText));
    assert.ok(!/Novo pedido!/.test(await K.page.title()), "título volta ao normal");
    assert.equal(K.erros.length, 0, K.erros.join("|"));
  });
  await K.ctx.close();

  const L = await mk();
  await passo("horários: site mostra o padrão; o painel edita e o site passa a mostrar o novo horário", async () => {
    await L.ctx.addInitScript(() => { if (location.pathname.startsWith("/admin")) localStorage.setItem("dogao_auth", JSON.stringify({ access_token: "tok-admin", refresh_token: "r", exp: Date.now() + 3600e3, email: "admin@teste.com" })); });
    const site = L.page; await site.goto("/");
    await site.waitForFunction(() => /18:30 às 05:00, todos os dias/.test(document.getElementById("hRetirada").textContent));
    assert.equal(await site.innerText("#hDelivery"), "18:30 às 01:00, exceto terças");
    assert.match(await site.innerText("#stDelivery"), /Delivery até 01:00/);
    const adm = await L.ctx.newPage(); const errosAdm = []; adm.on("pageerror", (e) => errosAdm.push(e.message));
    await adm.goto("/admin/"); await adm.locator("#app:not([hidden])").waitFor();
    await adm.click('[data-t="cardapio"]');
    await adm.locator('#horarios .hor[data-t="Retirada"] .abre').waitFor();
    assert.equal(await adm.inputValue('#horarios .hor[data-t="Delivery"] .fecha'), "01:00");
    assert.equal(await adm.locator('#horarios .hor[data-t="Delivery"] .dia[value="2"]').isChecked(), false); // terça desmarcada
    await adm.fill('#horarios .hor[data-t="Retirada"] .abre', "10:00");
    await adm.fill('#horarios .hor[data-t="Retirada"] .fecha', "23:00");
    await adm.locator('#horarios .hor[data-t="Retirada"] .dia[value="1"]').uncheck(); // fecha às segundas
    await adm.click("#salvaHorarios");
    await adm.waitForFunction(() => /Horários salvos/.test(document.getElementById("horMsg").textContent));
    assert.equal(est.tabelas.config.find((c) => c.chave === "horarios").valor.Retirada.abre, "10:00");
    // erro de validação aparece na tela
    await adm.fill('#horarios .hor[data-t="Delivery"] .fecha', "18:30");
    await adm.click("#salvaHorarios");
    await adm.waitForFunction(() => /inválidos/.test(document.getElementById("horErro").textContent));
    await adm.click('[data-t="historico"]');
    await adm.waitForFunction(() => /Horários de atendimento/.test(document.getElementById("hist").innerText));
    await site.reload();
    await site.waitForFunction(() => /10:00 às 23:00, exceto segundas/.test(document.getElementById("hRetirada").textContent));
    assert.match(await site.innerText("#stRetirada"), /até 23:00/);
    assert.deepEqual(errosAdm, []); assert.deepEqual(L.erros, []);
  });
  await L.ctx.close();

  const M = await mk();
  await passo("bairros: painel cadastra; carrinho pede o bairro, mostra a taxa e o Pix cobra a taxa do bairro", async () => {
    await M.ctx.addInitScript(() => { if (location.pathname.startsWith("/admin")) localStorage.setItem("dogao_auth", JSON.stringify({ access_token: "tok-admin", refresh_token: "r", exp: Date.now() + 3600e3, email: "admin@teste.com" })); });
    const adm = await M.ctx.newPage(); const errosAdm = []; adm.on("pageerror", (e) => errosAdm.push(e.message));
    const carregou = adm.waitForResponse((r) => r.url().includes("a=bairros") && r.request().method() === "GET");
    await adm.goto("/admin/#cardapio"); await carregou; await adm.locator("#bairrosTxt").waitFor(); await adm.waitForTimeout(300);
    await adm.fill("#bairrosTxt", "Centro; 6,00\nVila Nova sem valor");
    await adm.click("#salvaBairros");
    assert.match(await adm.innerText("#bairrosErro"), /Linha 2: use o formato Nome; valor/);
    assert.equal(est.tabelas.config.some((c) => c.chave === "bairros"), false);
    await adm.fill("#bairrosTxt", "Centro; 6,00\nVila Nova; 9,5\n\nGrátis; 0");
    await adm.click("#salvaBairros");
    await adm.waitForFunction(() => /Bairros salvos/.test(document.getElementById("bairrosMsg").textContent));
    await adm.waitForFunction(() => document.getElementById("bairrosTxt").value === "Centro; 6,00\nVila Nova; 9,50\nGrátis; 0,00"); // recarregado do servidor, normalizado
    await adm.fill("#bairrosTxt", "Centro; 6,00\nCentro; 7,00");
    await adm.click("#salvaBairros");
    await adm.waitForFunction(() => /inválidos/.test(document.getElementById("bairrosErro").textContent));
    assert.deepEqual(errosAdm, []);

    const p = M.page; await montarPedido(p);   // Dogão R$ 18, Delivery
    assert.equal(await p.locator("#bairroWrap").isVisible(), true);
    const opcoes = (await p.locator("#bairro option").allInnerTexts()).map((t) => t.replace(/\u00a0/g, " ")); // o navegador usa espaço sem quebra em "R$ 6,00"
    assert.deepEqual(opcoes, ["Escolha o bairro", "Centro — R$ 6,00", "Vila Nova — R$ 9,50", "Grátis — entrega grátis", "Outro bairro — R$ 6,00"]);
    assert.equal(await p.innerText("#taxa"), "escolha o bairro");
    await p.click("#pix");
    assert.equal(await p.innerText("#erro"), "Escolha o bairro da entrega.");
    await p.selectOption("#bairro", "Vila Nova");
    assert.match(await p.innerText("#taxa"), /9,50/); assert.match(await p.innerText("#total"), /27,50/);
    await p.selectOption("#bairro", "Grátis");
    assert.equal(await p.locator("#sumTaxa").isHidden(), true); assert.match(await p.innerText("#total"), /18,00/);
    await p.selectOption("#bairro", "__outro"); assert.match(await p.innerText("#total"), /24,00/);
    await p.selectOption("#bairro", "Vila Nova");
    assert.ok(await semRolagemHorizontal(p), "rolagem horizontal com o seletor de bairro");
    await p.click('label:has(input[value="Retirada"]) span');
    assert.equal(await p.locator("#bairroWrap").isHidden(), true); assert.match(await p.innerText("#total"), /18,00/);
    await p.click('label:has(input[value="Delivery"]) span');
    await p.click("#pix"); await p.locator("#dlgPix[open]").waitFor();
    assert.match(await p.innerText("#pixValor"), /27,50/);
    const ped = est.tabelas.pedidos.at(-1);
    assert.deepEqual([ped.taxa, ped.total, ped.endereco], [9.5, 27.5, "Rua das Flores, 123 (bairro: Vila Nova)"]);
    assert.deepEqual(M.erros, []);
  });
  await M.ctx.close();

  const N = await mk();
  await passo("painel: botão 'Avisar o cliente' (WhatsApp com mensagem pronta) em preparo/pronto, com número correto", async () => {
    const mkPed = (n, extra) => ({ id: `00000000-0000-4000-8000-00000000010${n}`, ref: `DAAVISO${n}`, nome: "Joana Prado", telefone: "11988887777", tipo: "Retirada", endereco: null, obs: null, itens: [{ id: "agua", nome: "Água", pao: "", q: 1, preco: 5 }], subtotal: 5, taxa: 0, total: 5, forma: "online", status: "pronto", criado_em: new Date().toISOString(), ...extra });
    est.tabelas.pedidos.push(mkPed(1, { status: "pronto", tipo: "Delivery", endereco: "Rua A, 1", taxa: 0 }), mkPed(2, { status: "pronto" }), mkPed(3, { status: "em_preparo" }),
      mkPed(4, { status: "pronto", telefone: "55999990000" }), mkPed(5, { status: "pronto", telefone: "5511977776666" }), mkPed(6, { status: "entregue" }));
    await N.ctx.addInitScript(() => localStorage.setItem("dogao_auth", JSON.stringify({ access_token: "tok-admin", refresh_token: "r", exp: Date.now() + 3600e3, email: "admin@teste.com" })));
    await N.page.goto("/admin/#pedidos");
    await N.page.waitForFunction(() => /DAAVISO1/.test(document.getElementById("listaPedidos").innerText));
    const href = async (ref) => N.page.locator(`article.ped:has-text("${ref}") a.avisar`).getAttribute("href");
    const dec = (h) => { const u = new URL(h); return { path: u.pathname, texto: u.searchParams.get("text") }; };
    const d = dec(await href("DAAVISO1")); assert.equal(d.path, "/5511988887777");
    assert.equal(d.texto, "Olá, Joana! Aqui é o Dogão do Adriano 🌭 Seu pedido DAAVISO1 está pronto e já vai sair para entrega 🛵");
    assert.equal(dec(await href("DAAVISO2")).texto, "Olá, Joana! Aqui é o Dogão do Adriano 🌭 Seu pedido DAAVISO2 está pronto! Pode vir retirar na praça 🌭");
    assert.equal(dec(await href("DAAVISO3")).texto, "Olá, Joana! Aqui é o Dogão do Adriano 🌭 Recebemos o seu pedido DAAVISO3 e já estamos preparando.");
    assert.equal(dec(await href("DAAVISO4")).path, "/5555999990000", "DDD 55 (RS) não pode perder o prefixo");
    assert.equal(dec(await href("DAAVISO5")).path, "/5511977776666", "número que já vem com 55 não duplica");
    await N.page.click('#filtros .chip[data-f="entregue"]');
    await N.page.waitForFunction(() => /DAAVISO6/.test(document.getElementById("listaPedidos").innerText));
    assert.equal(await N.page.locator('article.ped:has-text("DAAVISO6") a.avisar').count(), 0, "entregue não tem botão de aviso");
    assert.equal(await N.page.locator("article.ped:has-text('DANOVOPEDIDO1') a.avisar").count(), 0, "pedido novo não tem botão de aviso");
    assert.deepEqual(N.erros, []);
  });
  await N.ctx.close();

  const P = await mk();
  await passo("privacidade: página abre, links no rodapé e no carrinho, sem rolagem horizontal (claro e escuro)", async () => {
    const r = await P.page.goto("/privacidade.html");
    assert.equal(r.status(), 200);
    assert.match(await P.page.title(), /Política de Privacidade/);
    const txt = await P.page.innerText("main");
    for (const t of ["LGPD", "Mercado Pago", "Supabase", "Vercel", "Telegram", "não guardamos o seu e-mail do Pix", "Seus direitos", "(11) 99017-3256"]) assert.ok(txt.toLowerCase().includes(t.toLowerCase()), "falta: " + t);
    assert.ok(await semRolagemHorizontal(P.page), "rolagem horizontal na página de privacidade");
    await P.page.goto("/");
    assert.equal(await P.page.getAttribute('footer a[href="/privacidade.html"]', "href"), "/privacidade.html");
    await P.page.click("#openCart");
    assert.equal(await P.page.locator('.d-foot .fine a[href="/privacidade.html"]').count(), 1);
    assert.match(await P.page.innerText(".fine"), /Pix e cartão processados pelo Mercado Pago/);
    assert.deepEqual(P.erros, []);
  });
  await P.ctx.close();
  const Q = await mk({ colorScheme: "dark" });
  await passo("privacidade: modo escuro legível e sem rolagem horizontal em 390 px", async () => {
    await Q.page.goto("/privacidade.html");
    const cores = await Q.page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, tx: getComputedStyle(document.body).color }));
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    assert.ok(lum(cores.bg) < 0.25 && lum(cores.tx) > 0.7, JSON.stringify(cores));
    assert.ok(await semRolagemHorizontal(Q.page));
    if (FOTOS) await Q.page.screenshot({ path: FOTOS + "/6-privacidade-390-escuro.png", fullPage: false });
  });
  await Q.ctx.close();

  const R = await mk();
  await passo("adicionais: não aparecem como aba nem avulsos; janela 'Quer adicionar algo?' dentro do lanche", async () => {
    await R.page.goto("/"); await R.page.locator("[data-add]").first().waitFor();
    const abas = await R.page.locator("#tabs .tab").allInnerTexts();
    assert.deepEqual(abas, ["Dogões", "Bebidas"]);                   // sem "Adicionais"
    assert.equal(await R.page.locator('[data-add="bacon"]').count(), 0);
    // cancelar não adiciona
    await R.page.locator('[data-add="tradicional"]').click();
    await R.page.locator("#dlgAdd[open]").waitFor();
    assert.equal(await R.page.innerText("#addTit"), "Dogão Tradicional (pão de banha)");
    assert.match(await R.page.innerText("#addSub"), /Quer adicionar algo/);
    const ops = (await R.page.locator("#addLista .add-op").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim());
    assert.deepEqual(ops, ["Bacon + R$ 6,00", "Purê + R$ 6,00", "Queijo ralado + R$ 2,00"]);   // sem o desativado
    for (const op of await R.page.locator("#addLista .add-op").all()) assert.ok((await op.boundingBox()).height >= 44);
    assert.ok(await semRolagemHorizontal(R.page));
    assert.equal(await R.page.evaluate(() => document.activeElement.id), "dlgAdd");
    if (FOTOS) await R.page.screenshot({ path: FOTOS + "/7-adicionais-390.png" });
    await R.page.click("#addCancela");
    assert.equal(await R.page.innerText("#count"), "0");
    // preço do botão acompanha a escolha
    const btn = async () => (await R.page.innerText("#addOk")).replace(/\u00a0/g, " ");
    await R.page.selectOption('[data-pao="tradicional"]', "Sal");
    await R.page.locator('[data-add="tradicional"]').click(); await R.page.locator("#dlgAdd[open]").waitFor();
    assert.equal(await R.page.innerText("#addTit"), "Dogão Tradicional (pão de sal)");
    assert.equal(await btn(), "Adicionar ao pedido · R$ 18,00");
    await R.page.check('#addLista input[value="bacon"]'); assert.equal(await btn(), "Adicionar ao pedido · R$ 24,00");
    await R.page.check('#addLista input[value="queijo"]'); assert.equal(await btn(), "Adicionar ao pedido · R$ 26,00");
    await R.page.uncheck('#addLista input[value="queijo"]'); assert.equal(await btn(), "Adicionar ao pedido · R$ 24,00");
    await R.page.check('#addLista input[value="queijo"]');
    await R.page.click("#addOk");
    assert.equal(await R.page.innerText("#count"), "1");
    // outro dogão igual sem adicionais vira OUTRA linha; mesmo dogão com os mesmos adicionais soma na mesma linha
    await R.page.locator('[data-add="tradicional"]').click(); await R.page.locator("#dlgAdd[open]").waitFor(); await R.page.click("#addOk");
    await R.page.locator('[data-add="tradicional"]').click(); await R.page.locator("#dlgAdd[open]").waitFor();
    await R.page.check('#addLista input[value="queijo"]'); await R.page.check('#addLista input[value="bacon"]'); await R.page.click("#addOk");
    assert.equal(await R.page.innerText("#count"), "3");
    // bebida: adiciona direto, sem janela
    await R.page.click('#tabs .tab:has-text("Bebidas")');
    await R.page.locator('[data-add="agua"]').click();
    assert.equal(await R.page.locator("#dlgAdd").evaluate((d) => d.open), false);
    await R.page.click("#openCart");
    const linhas = (await R.page.locator("#lines .line").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").replace(/\u00a0/g, " "));
    assert.equal(linhas.length, 3, linhas.join(" | "));
    assert.match(linhas[0], /Dogão Tradicional \+ Bacon \+ Queijo ralado Pão de sal · R\$ 26,00 cada.*2.*R\$ 52,00/);
    assert.match(linhas[1], /Dogão Tradicional Pão de sal · R\$ 18,00 cada.*1.*R\$ 18,00/);
    assert.match(linhas[2], /Água/);
    await R.page.selectOption("#bairro", "Centro");                                          // (bairros cadastrados no teste anterior; taxa 6)
    assert.match((await R.page.innerText("#total")).replace(/\u00a0/g, " "), /R\$ 81,00/);   // 52 + 18 + 5 + taxa 6
    assert.ok(await semRolagemHorizontal(R.page));
    // aumentar a quantidade mantém os adicionais
    await R.page.locator('#lines .line:nth-child(2) .qty button[data-d="1"]').click();
    assert.match((await R.page.innerText("#lines .line:nth-child(2)")).replace(/\s+/g, " "), /Dogão Tradicional.*Pão de sal.*2/);
    await R.page.locator('#lines .line:nth-child(2) .qty button[data-d="-1"]').click();
    // vai para o Pix: servidor recalcula e grava o snapshot com adicionais
    await R.page.fill("#nome", "Maria da Silva"); await R.page.fill("#tel", "11999991234"); await R.page.fill("#end", "Rua das Flores, 123");
    await R.page.fill("#email", "maria@exemplo.com");
    await R.page.click('label:has(input[value="Retirada"]) span');
    assert.match((await R.page.innerText("#total")).replace(/\u00a0/g, " "), /R\$ 75,00/);
    await R.page.click("#pix"); await R.page.locator("#dlgPix[open]").waitFor();
    assert.match((await R.page.innerText("#pixValor")).replace(/\u00a0/g, " "), /R\$ 75,00/);
    const ped = est.tabelas.pedidos.at(-1);
    assert.equal(ped.total, 75);
    assert.deepEqual(ped.itens.map((i) => [i.id, i.pao, i.q, i.preco, i.adds.map((a) => a.id).sort()]),
      [["tradicional", "Sal", 2, 26, ["bacon", "queijo"]], ["tradicional", "Sal", 1, 18, []], ["agua", "", 1, 5, []]]);
    assert.deepEqual(R.erros, []);
  });
  await R.ctx.close();
  const T = await mk();
  await passo("adicionais: carrinho antigo (adicional avulso) é limpo; carrinho com adicionais sobrevive ao recarregar", async () => {
    await T.ctx.addInitScript(() => { if (!sessionStorage.getItem("semeado")) { sessionStorage.setItem("semeado", "1"); localStorage.setItem("dogao_cart", JSON.stringify([{ id: "bacon", pao: "", q: 2 }, { id: "agua", pao: "", q: 1 }, { id: "tradicional", pao: "Banha", q: 1, adds: ["pure", "esgotado", "agua", "tradicional"] }])); } });
    await T.page.goto("/"); await T.page.locator("[data-add]").first().waitFor();
    await T.page.click("#openCart");
    const linhas = (await T.page.locator("#lines .line").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    assert.equal(linhas.length, 2, linhas.join("|"));
    assert.match(linhas.join("|"), /Água/); assert.match(linhas.join("|"), /Dogão Tradicional \+ Purê/);
    assert.doesNotMatch(linhas.join("|"), /Bacon|Ovo/);                 // adicional avulso e adicional desativado saem
    await T.page.reload(); await T.page.locator("[data-add]").first().waitFor(); await T.page.click("#openCart");
    assert.equal(await T.page.locator("#lines .line").count(), 2);
    assert.deepEqual(T.erros, []);
  });
  await T.ctx.close();
  const U = await mk({ colorScheme: "dark" });
  await passo("adicionais: modo escuro legível; 'Pedir de novo' leva os adicionais (e ignora os que acabaram)", async () => {
    est.tabelas.pedidos.push({ id: "00000000-0000-4000-8000-0000000000aa", ref: "DAREPETE1", user_id: "u-cliente", nome: "Cliente Logado", telefone: "11999990000", tipo: "Retirada", endereco: null, obs: null,
      itens: [{ id: "tradicional", nome: "Dogão Tradicional", pao: "Sal", q: 2, preco: 29, base: 18, adds: [{ id: "bacon", nome: "Bacon", preco: 6 }, { id: "esgotado", nome: "Ovo", preco: 3 }] }],
      subtotal: 58, taxa: 0, total: 58, forma: "online", status: "pago", criado_em: new Date().toISOString() });
    await U.page.goto("/"); await U.page.locator("[data-add]").first().waitFor();
    await U.page.locator('[data-add="tradicional"]').click(); await U.page.locator("#dlgAdd[open]").waitFor();
    const cores = await U.page.evaluate(() => { const c = (s, p) => getComputedStyle(document.querySelector(s))[p]; return { dlg: c("#dlgAdd", "backgroundColor"), txt: c("#dlgAdd", "color"), op: c(".add-op", "backgroundColor") }; });
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    assert.ok(lum(cores.dlg) < 0.25 && lum(cores.txt) > 0.7 && lum(cores.op) < 0.25, JSON.stringify(cores));
    if (FOTOS) await U.page.screenshot({ path: FOTOS + "/8-adicionais-390-escuro.png" });
    await U.page.click("#addCancela");
    await U.page.click("#openConta"); await U.page.fill("#lgEmail", "cliente@teste.com"); await U.page.fill("#lgSenha", "senha12345"); await U.page.click("#lgOk");
    await U.page.waitForFunction(() => /Cliente/.test(document.getElementById("openConta").textContent));
    await U.page.click("#openConta"); await U.page.locator("#dlgConta[open]").waitFor();
    assert.match(await U.page.innerText("#cPedidos"), /2x Dogão Tradicional \(sal\) \+ Bacon \+ Ovo/);
    await U.page.click("[data-repetir]");
    await U.page.locator("#drawer.on").waitFor();
    const l = (await U.page.innerText("#lines .line")).replace(/\s+/g, " ").replace(/\u00a0/g, " ");
    assert.match(l, /Dogão Tradicional \+ Bacon Pão de sal · R\$ 24,00 cada.*2/);
    assert.doesNotMatch(l, /Ovo/);
    assert.deepEqual(U.erros, []);
  });
  await U.ctx.close();

  const V = await mk();
  await passo("painel: pedido mostra os adicionais do lanche (texto escapado) e o cardápio explica os adicionais", async () => {
    est.tabelas.pedidos.push({ id: "00000000-0000-4000-8000-0000000000bb", ref: "DAADIC001", user_id: null, nome: "Marcos", telefone: "11999990000", tipo: "Retirada", endereco: null, obs: null,
      itens: [{ id: "tradicional", nome: "Dogão Tradicional", pao: "Sal", q: 2, preco: 26, base: 18, adds: [{ id: "bacon", nome: "Bacon", preco: 6 }, { id: "queijo", nome: "Queijo <img src=x onerror=window.__x=1>", preco: 2 }] }],
      subtotal: 52, taxa: 0, total: 52, forma: "online", status: "pago", criado_em: new Date().toISOString() });
    await V.ctx.addInitScript(() => localStorage.setItem("dogao_auth", JSON.stringify({ access_token: "tok-admin", refresh_token: "r", exp: Date.now() + 3600e3, email: "admin@teste.com" })));
    await V.page.goto("/admin/#pedidos");
    await V.page.waitForFunction(() => /DAADIC001/.test(document.getElementById("listaPedidos").innerText));
    const card = (await V.page.locator('article.ped:has-text("DAADIC001")').innerText()).replace(/\s+/g, " ");
    assert.match(card, /2× Dogão Tradicional \(pão de sal\) \+ Bacon \+ Queijo <img src=x onerror=window.__x=1>/);
    assert.equal(await V.page.evaluate(() => window.__x), undefined);
    await V.page.click('[data-t="cardapio"]');
    await V.page.waitForFunction(() => /aparecem dentro de cada lanche/.test(document.getElementById("listaItens").innerText));
    assert.deepEqual(V.erros, []);
  });
  await V.ctx.close();

  await browser.close(); servidor.close();
  console.log(`\n${ok} verificações passaram${process.exitCode ? ", HÁ FALHAS" : ""}.`);
})().catch((e) => { console.error(e); process.exit(1); });
