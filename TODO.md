# TODO — Dogão do Adriano

Legenda: [x] concluído e verificado · [ ] pendente · P1 alta, P2 média, P3 baixa.

## Em andamento
- [ ] P2 · Etapa C: página de política de privacidade/termos (LGPD) e link no rodapé. (Não foi pedida nesta rodada; fazer só se o dono quiser.)

## Pendentes
- [ ] P1 · (dono) Testar Pix real de R$ 4–5 de outro banco, conferir Telegram e `/admin`, estornar.
- [ ] P1 · (dono) Diagnosticar login ausente: abrir `/api/status`; se `"auth":null`, conferir `SUPABASE_URL` e `SUPABASE_ANON_KEY` na Vercel e fazer Redeploy.
- [x] Etapa D (comanda/tela de cozinha): DESCARTADA a pedido do dono em 28/10. Não fazer.
- [ ] P2 · Responder ao dono: custos (hospedagem, domínio, taxas Mercado Pago) e quanto cobrar. Pesquisa de preços foi interrompida pelo limite de uso; refazer.

## Concluídas
- [x] Etapa G: botão "Avisar o cliente" (WhatsApp com mensagem pronta) nos pedidos em preparo/pronto + correção do número com DDD 55 — navegador 23/23
- [x] Etapa F: taxa de entrega por bairro (lista no `/admin`, seletor no carrinho, servidor calcula) — API 46/46, navegador 22/22
- [x] Etapa E: horários de atendimento editáveis no `/admin` (site, rodapé e cobrança usam o mesmo valor) — API 41/41, navegador 21/21
- [x] Etapa B: alerta de pedido novo no `/admin` (banner, título piscando, som opcional) — API 37/37, navegador 20/20
- [x] Etapa A: aviso no Telegram para pedidos por WhatsApp — API 37/37 e navegador 19/19
- [x] Pix no site (backend + front) — testado (API 35/35, navegador 19/19 simulados)
- [x] `/api/pedido` sem dados pessoais
- [x] Aviso de pagamento aprovado uma única vez
- [x] Correção de rolagem horizontal do cabeçalho em 390 px
- [x] README atualizado (chave Pix, teste real, pagamentos)
- [x] Bot do Telegram configurado pelo dono (token e chat ID na Vercel)
- [x] Arquivos de acompanhamento TODO.md e PROGRESSO.md criados
