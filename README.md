# Dogão do Adriano — site de pedidos + painel administrativo

Um projeto só, na Vercel:
- `public/index.html` → site dos clientes (cardápio, carrinho, pagamento Pix/cartão, login opcional, "meus pedidos")
- `public/admin/index.html` → painel dos administradores (`/admin`)
- `api/` → funções do servidor (6 funções; o plano gratuito permite até 12)
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
- **Cardápio e preços:** altera preço, tira/volta item do cardápio ("acabou o kibe"), cria item novo e define a taxa de entrega. A mudança vale na hora no site e na cobrança.
- **Equipe** e **Histórico** (quem mudou qual preço e quando).

## Como a segurança funciona
- O navegador nunca acessa as tabelas: elas têm RLS ligado e sem permissões. Só as funções em `api/` (com a chave secreta) leem e gravam.
- Toda função do painel (`api/admin.js`) confere no servidor o login e se o perfil é `admin`. Esconder um botão não protege nada; o servidor recusa (401/403).
- O preço cobrado vem sempre do banco, nunca do navegador. O pedido guarda o preço da hora da compra.
- Textos digitados por clientes (nome, observação, endereço) são escapados no painel.

## Observações
- Itens marcados com ⚠ no painel tiveram o preço tirado de fotos antigas do cardápio: confira e salve para tirar o aviso.
- Pedidos feitos por "pagar na entrega" (WhatsApp) também ficam registrados, mas só entram nos números do Resumo depois que você os marca como pago, em preparo, pronto ou entregue.
- `public/menu.json` só é usado se o Supabase não estiver configurado (modo de emergência).
- Horários: `api/_horario.js` (retirada 18:30–05:00; delivery 18:30–01:00, exceto terças).
- Em produção o plano da Vercel precisa permitir uso comercial (Pro); confira os termos.
