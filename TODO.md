# TODO — Dogão do Adriano

Legenda: [x] concluído e verificado · [ ] pendente · P1 alta, P2 média, P3 baixa.

## Em andamento
- [ ] P1 · (dono + Claude) Cadastrar os bairros e taxas no `/admin`: o dono envia a lista de bairros e valores; Claude monta o texto `Nome; valor` para colar em Cardápio e preços > Taxa por bairro. Decisão: manter taxa por bairro; só considerar API de distância depois de semanas de pedidos reais.
- [ ] P3 · (dono) Revisar `public/privacidade.html` (modelo; sugerido incluir razão social/CNPJ do responsável e, se quiser, revisão de um advogado). Não há termos de uso separados.

## Pendentes
- [ ] P1 · (dono) Cadastrar horários reais, taxa/bairros e conferir preços marcados com ⚠ no `/admin`; remover `IGNORAR_HORARIO` se existir.
- [ ] P1 · (dono) Criar contas da equipe e dar acesso admin (aba Equipe).
- [ ] P2 · Hospedagem comercial (Vercel Pro/Supabase Pro + backup) e domínio próprio (atualizar `SITE_URL` e o Site URL do Supabase).
- [x] Etapa D (comanda/tela de cozinha): DESCARTADA a pedido do dono em 28/10. Não fazer.
- [ ] P2 · Responder ao dono: custos (hospedagem, domínio, taxas Mercado Pago) e quanto cobrar. Pesquisa de preços foi interrompida pelo limite de uso; refazer.

## Concluídas
- [x] Adicionais DENTRO do lanche (H1 backend, H2 site, H3 painel/conta, H4 docs): janela "Quer adicionar algo?", linhas separadas no carrinho, preço recalculado no servidor, pedir de novo, painel mostra os adicionais — API 51/51, navegador 29/29
- [x] Etapa C: página `/privacidade.html` (LGPD) + links no rodapé e no carrinho — navegador 25/25
- [x] Testes reais do dono em 28/10: aviso no Telegram, webhook (com a aba fechada), cartão e estorno funcionaram
- [x] Pix em produção funcionando (confirmado pelo dono em 28/10)
- [x] Login visível no site (config `auth` OK)
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
