# Dogão do Adriano — site de pedidos + painel administrativo

Um projeto só, na Vercel:
- `public/index.html` → site dos clientes (cardápio, carrinho, Pix no próprio site, cartão, login opcional, "meus pedidos")
- `public/admin/index.html` → painel dos administradores (`/admin`)
- `api/` → funções do servidor (7 funções: admin, checkout, conta, menu, pedido, status, webhook; o plano gratuito permite até 12)
- `supabase/schema.sql` → banco de dados (Supabase)

## Ordem para colocar no ar

### 1. Banco de dados (Supabase)
1. No Supabase abra **SQL Editor > New query**, cole **todo** o conteúdo de `supabase/schema.sql` e clique em **Run**.
   (Cria as tabelas, bloqueia o acesso direto pelo navegador e já cadastra o cardápio. Pode rodar de novo sem apagar dados.)
2. **Authentication > Sign In / Providers > Email**: desligue **Confirm email** (assim o cliente entra na hora; com ele ligado o Supabase precisa mandar e-mail, e o envio padrão é limitado a poucos por hora). Deixe o mínimo de senha em 8.
3. **Authentication > URL Configuration**: em **Site URL** coloque o endereço do site (o mesmo de `SITE_URL`). É por ele que o link de "esqueci a senha" volta para o site.

### 2. Variáveis na Vercel (Settings > Environment Variables)
| Variável | Obrigatória | O que é |
|---|---|---|
| `MP_ACCESS_TOKEN` | sim | Access Token do Mercado Pago (da conta de quem vai receber) |
| `SITE_URL` | sim | Endereço final do site, sem barra no fim |
| `SUPABASE_URL` | sim | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | sim | Publishable key do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Secret key do Supabase (**nunca** em código nem em chat) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | recomendadas | Aviso no Telegram a cada pagamento aprovado |
| `MP_WEBHOOK_SECRET` | opcional | Assinatura do webhook do Mercado Pago |
| `IGNORAR_HORARIO` | só testes | `1` libera pedidos fora do horário (remova depois) |

Depois de salvar, faça **Redeploy**.

### 2b. Habilitar o Pix na conta Mercado Pago (obrigatório para o botão "Pagar com Pix")
A conta Mercado Pago de quem recebe precisa ter **uma chave Pix cadastrada**: app Mercado Pago > **Pix** > **Minhas chaves** (CPF/CNPJ, e-mail, celular ou chave aleatória). Sem isso o Mercado Pago recusa o Pix (erro típico nos logs da Vercel: `Collector user without key enabled for QR render`) e o cliente vê "Pix indisponível no momento. Pague com cartão ou combine pelo WhatsApp."

### 3. Primeiro administrador
1. No site, clique em **Entrar > Criar conta** e cadastre o e-mail do dono.
2. No Supabase (SQL Editor) rode, trocando o e-mail:
   ```sql
   update public.perfis set role = 'admin' where email = 'SEU-EMAIL@exemplo.com';
   ```
3. Abra `/admin` e entre. Os próximos administradores você adiciona pela aba **Equipe** (a pessoa só precisa ter criado conta).

## O que o painel faz
- **Resumo:** faturamento, pedidos, ticket médio, itens mais pedidos, pedidos por horário e por dia (hoje, 7, 30 ou 90 dias, com comparação com o período anterior).
- **Pedidos:** lista com dados do cliente, itens e endereço; botões de "iniciar preparo", "pronto", "entregue" e "cancelar".
- **Alerta de pedido novo:** banner, título da aba piscando e som opcional (botão "Som", é preciso clicar uma vez na página para o navegador liberar o áudio). Confere a cada 15 s.
- **Avisar o cliente:** pedidos "em preparo" e "pronto" têm o botão "Avisar o cliente", que abre o WhatsApp com a mensagem pronta (sem custo de API).
- **Cardápio e preços:** altera preço, tira/volta item do cardápio ("acabou o kibe"), cria item novo e define a taxa de entrega (única ou por bairro: uma linha `Nome; valor` por bairro; quem escolhe "Outro bairro" paga a taxa única). A mudança vale na hora no site e na cobrança.
- **Equipe** e **Histórico** (quem mudou qual preço e quando).

## Pagamentos: Pix no site e cartão pelo Mercado Pago
O carrinho tem três opções:
1. **Pagar com Pix** (principal): o site cria o pagamento pela API de Pagamentos do Mercado Pago (`POST /v1/payments`) e mostra, numa janela, o QR code e o "Pix Copia e Cola". O cliente paga pelo app de qualquer banco, **sem conta no Mercado Pago e sem sair do site**. O site confere a cada 4 s (`GET /api/pedido?ref=...`, que só devolve o status) e, quando o Pix é aprovado, mostra "Pagamento aprovado" e limpa o carrinho. O código vale 30 minutos. O dinheiro cai na conta Mercado Pago do estabelecimento.
2. **Pagar com cartão (Mercado Pago)**: Checkout Pro, como antes (o cliente é levado à página do Mercado Pago).
3. **Pedir no WhatsApp e pagar na entrega**: como antes.

Detalhes:
- O pedido é gravado como `aguardando_pagamento` e vira `pago` quando o Mercado Pago confirma, por **webhook** (`/api/webhook`) ou pela consulta do site, o que chegar primeiro. O aviso no Telegram sai **uma única vez** por pedido.
- **Telegram:** com `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` configurados, o grupo recebe "✅ PAGAMENTO APROVADO" (Pix/cartão) e "🕒 NOVO PEDIDO (pagar na entrega/retirada)" (pedidos pelo WhatsApp, ainda não pagos).
- O e-mail digitado no carrinho serve só para o Pix (o Mercado Pago exige) e **não é gravado** no banco nem nos logs.
- Preço e total são sempre calculados no servidor.
- Configure o webhook no Mercado Pago (Suas integrações > Webhooks, evento **Pagamentos**, URL `SITE_URL/api/webhook`) ou deixe como está: o pagamento Pix já envia a `notification_url` e o site também consulta sozinho.

### Como testar o Pix de verdade
1. Deixe o `MP_ACCESS_TOKEN` de **produção** configurado e a chave Pix cadastrada (item 2b).
2. Faça um pedido pequeno real, de pelo menos R$ 4–5 (ex.: uma Água): valores muito baixos (R$ 0,10) podem não oferecer Pix/cartão.
3. Pague **de outro banco ou de outra conta** (não pague da própria conta Mercado Pago que recebe).
4. Confira: a tela mostrou "Pagamento aprovado", o pedido apareceu como "pago online (Pix)" em `/admin` e o aviso chegou no Telegram.
5. Estorne o Pix no app/site do Mercado Pago (Atividades > o pagamento > Devolver dinheiro). O pedido passa a "cancelado".

### Testes automáticos
`node tests/api.test.js` roda a API com um Supabase e um Mercado Pago simulados (sem rede e sem dependências). `node tests/browser.test.js` abre o site num navegador (Playwright) com os mesmos simulados.

## Como a segurança funciona
- O navegador nunca acessa as tabelas: elas têm RLS ligado e sem permissões. Só as funções em `api/` (com a chave secreta) leem e gravam.
- Toda função do painel (`api/admin.js`) confere no servidor o login e se o perfil é `admin`. Esconder um botão não protege nada; o servidor recusa (401/403).
- O preço cobrado vem sempre do banco, nunca do navegador. O pedido guarda o preço da hora da compra.
- Textos digitados por clientes (nome, observação, endereço) são escapados no painel.

## Observações
- Itens marcados com ⚠ no painel tiveram o preço tirado de fotos antigas do cardápio: confira e salve para tirar o aviso.
- Pedidos feitos por "pagar na entrega" (WhatsApp) também ficam registrados, mas só entram nos números do Resumo depois que você os marca como pago, em preparo, pronto ou entregue.
- `public/menu.json` só é usado se o Supabase não estiver configurado (modo de emergência).
- Horários de atendimento: editáveis em `/admin` > **Cardápio e preços** > Horários de atendimento (abre, fecha e dias de cada tipo; se fechar for menor que abrir, passa da meia-noite). Ficam na tabela `config` (chave `horarios`); o site, o rodapé e a cobrança usam o mesmo valor. Pode levar até ~15 s para valer em todas as instâncias do servidor. Sem nada salvo, vale o padrão de `api/_horario.js` (retirada 18:30–05:00 todos os dias; delivery 18:30–01:00, exceto terças).
- Em produção o plano da Vercel precisa permitir uso comercial (Pro); confira os termos.
