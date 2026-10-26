# Dogão do Adriano — site de pedidos

Site estático (`public/`) + 3 funções serverless na Vercel (`api/`).
Pagamento online (Pix e cartão) pelo **Mercado Pago Checkout Pro**; alternativa: pedido por WhatsApp pagando na entrega.

## 1. Mercado Pago
1. Crie/entre na conta em mercadopago.com.br e abra **Seu negócio > Configurações > Credenciais** (ou developers: *Suas integrações*).
2. Crie uma aplicação do tipo **Checkout Pro** e copie o **Access Token de produção** (`APP_USR-...`).
3. Para testar antes, use as credenciais de teste e as contas de teste do próprio Mercado Pago.

## 2. Vercel
1. Suba esta pasta num repositório do GitHub e importe em vercel.com (framework: *Other*; sem build).
2. Em **Settings > Environment Variables** crie:

| Variável | Obrigatória | Para quê |
|---|---|---|
| `MP_ACCESS_TOKEN` | sim | Access Token do Mercado Pago |
| `SITE_URL` | recomendada | URL final, ex.: `https://dogaodoadriano.com.br` (usada nos retornos e no webhook) |
| `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` | recomendadas | Aviso de pedido pago no Telegram do dono (crie o bot com o @BotFather) |
| `MP_WEBHOOK_SECRET` | opcional | Assinatura do webhook (painel do Mercado Pago > Webhooks) |
| `IGNORAR_HORARIO` | só testes | `1` libera pedidos fora do horário |

3. Faça o deploy. No painel do Mercado Pago você pode cadastrar também `https://SEU-SITE/api/webhook` em Webhooks (evento *Pagamentos*); o site já envia essa URL em cada pedido.

## 3. Cardápio e taxa
Tudo em `public/menu.json` (preços, itens, taxa de entrega, WhatsApp). Os preços usados no pagamento são lidos desse arquivo **no servidor**.
Itens com `"verificar": true` tiveram o preço tirado de fotos antigas do cardápio: confira.
`taxaEntrega` está em `0`; coloque o valor se cobrar entrega.

## 4. Horários (arquivo `api/_horario.js`)
Retirada/presencial: 18:30–05:00 todos os dias. Delivery: 18:30–01:00, exceto terças. Fora disso o botão de pagar fica bloqueado.
