# PROGRESSO — Dogão do Adriano

> Estado real do projeto. Atualize junto com TODO.md ao fim de cada etapa. Nunca registre senhas, tokens ou chaves aqui.

## Objetivo geral
Site de pedidos do Dogão do Adriano (Osasco/SP) na Vercel + Supabase, com pagamento sem exigir conta no Mercado Pago:
Pix dentro do site (QR + copia e cola), cartão via Checkout Pro e pedido por WhatsApp (pagar na entrega). Avisos de pedido por Telegram.

## Decisões do dono
- 28/10: fazer B (alerta no painel), E (horários editáveis), F (taxa por bairro), G (avisar cliente). NÃO fazer a tela de cozinha/comanda (etapa D descartada).

## Concluído
- Pix no site (`POST /v1/payments` do Mercado Pago), com polling do status e tela "Pagamento aprovado".
- Aviso único de pagamento aprovado (webhook e polling não duplicam).
- `GET /api/pedido?ref=` devolve só `{status}` (sem dados pessoais).
- Campo e-mail no carrinho (só para o Pix; não é gravado nem logado).
- Correção do cabeçalho em 390 px (rolagem horizontal).
- Testes automáticos (API e navegador) com Supabase e Mercado Pago simulados.
- README com pré-requisito da chave Pix, teste real e seção de pagamentos.
- Etapa A: `api/checkout.js` avisa no Telegram os pedidos por WhatsApp (texto "🕒 NOVO PEDIDO (pagar na entrega/retirada)"); falha do Telegram não derruba o pedido.
- Etapa B: `/admin` consulta `GET /api/admin?a=novos` a cada 15 s; ao chegar pedido pago/WhatsApp novo mostra banner, pisca o título e toca som (botão "Som" liga/desliga, salvo no navegador; o navegador exige um clique na página para liberar o som). Arquivos: `api/admin.js`, `public/admin/index.html`.
- Etapa E: horários editáveis. `api/_horario.js` reescrito (config em `config.horarios`, padrão idêntico ao antigo, janela pode passar da meia-noite, cache de 15 s, volta ao padrão se o banco falhar). `checkout.js` e `status.js` usam `horarios()`; `status.js` agora também devolve `horarios` (públicos). `admin.js` ganhou a ação `horarios` (GET/POST, validação estrita, auditoria). `/admin` ganhou o card "Horários de atendimento" (aba Cardápio e preços) e o histórico mostra a alteração. `public/index.html` mostra os horários dinâmicos (faixa do topo e card "Horários").
- Etapa F: taxa por bairro. Lista em `config.bairros` (`[{nome,taxa}]`, sem mudança de schema). `api/_menu.js` lê/valida (`lerBairros` tolerante, `validarBairros` estrito) e `/api/menu` publica `bairros`. `checkout.js`: com lista, Delivery exige `bairro` (nome da lista ou `__outro` = taxa única), senão 400 "Escolha o bairro da entrega."; taxa sempre do servidor; o bairro vai no fim do endereço salvo ("… (bairro: X)"), no resumo/Telegram e no item de taxa do cartão. `admin.js`: ação `bairros` (GET/POST, auditoria). `/admin` > Cardápio e preços: card "Taxa por bairro" (uma linha `Nome; valor`). `public/index.html`: select de bairro no carrinho (só Delivery e só se houver lista). Lista vazia = comportamento antigo (taxa única).
- Etapa G: `/admin` > Pedidos: pedidos "Em preparo" e "Pronto" ganharam o botão "📲 Avisar o cliente" (abre `wa.me/<número>?text=...` com mensagem pronta: preparando / pronto para retirada / pronto e saindo para entrega). Sem API paga: o dono clica e envia. Também corrigido o link do telefone (antes removia o "55" inicial, o que quebrava o DDD 55 do RS). Só `public/admin/index.html`.
- Bot do Telegram criado e chat ID obtido pelo dono; variáveis colocadas na Vercel e redeploy feito.

## Arquivos alterados/criados na etapa Pix
- Novos: `api/_pagamento.js`, `api/pedido.js`, `tests/harness.js`, `tests/api.test.js`, `tests/browser.test.js`, `TODO.md`, `PROGRESSO.md`
- Alterados: `api/checkout.js` (modo pix; aviso do WhatsApp), `api/webhook.js` (refatorado), `public/index.html` (e-mail, botões, janela Pix, cabeçalho), `README.md`, `package.json` (scripts de teste)
- `public/admin/index.html`: sem mudança (já mostra `mp_metodo`).

## O que está funcionando (verificado)
- `node tests/api.test.js`: 46/46 passam.
- `node tests/browser.test.js`: 23/23 passam.
- Funções serverless: 7 (limite do plano gratuito: 12).

## Erros conhecidos / pontos em aberto
- Pix real ainda NÃO foi provado contra o Mercado Pago de produção (só simulado). Depende do dono testar com R$ 4–5.
- Dono relatou que o botão "Entrar" (login) não apareceu no site publicado. Causa provável: `SUPABASE_URL`/`SUPABASE_ANON_KEY` ausentes na Vercel (o botão só aparece se `/api/status` devolve `auth`). Não confirmado.
- Aviso de Telegram: agora cobre pagamento aprovado e pedidos por WhatsApp. Falta o dono publicar (commit + redeploy) para valer no site.
- Taxa por bairro é por lista de nomes (sem distância/mapa). Bairro vai embutido no texto do endereço (sem coluna própria no banco).
- Texto de horário no `/admin` > Resumo e no hero do site ("Peça aqui...") não mencionam horários; só o rodapé/faixa são dinâmicos.

## Testes executados e resultados
| Teste | Resultado |
|---|---|
| `node tests/api.test.js` | 46 passam, 0 falham (após etapa G) |
| `node tests/browser.test.js` | 23 passam (após etapa G) |

## Próxima ação exata
Todas as etapas pedidas nesta rodada (A, B, E, F, G) estão concluídas; a D (cozinha/comanda) foi descartada pelo dono. Nada em andamento.
1. Dono: publicar (commit + redeploy), conferir `/api/status` e testar o Pix real (ver abaixo).
2. Se o dono quiser mais: Etapa C (página de privacidade/LGPD) e a resposta sobre custos/preço de venda (pesquisa de preços foi interrompida por limite de uso; refazer com fontes antes de citar números).
3. Antes de qualquer mudança: `node tests/api.test.js` e `node tests/browser.test.js`.

## Configurações externas que dependem do dono
- Publicar esta versão (v5): commit no GitHub + redeploy. Não há SQL novo: horários e bairros usam a tabela `config` que já existe.
- Opcional no `/admin`: cadastrar horários reais e bairros (se quiser taxa por bairro), clicar em "Som" para ativar o alerta.
- Para testar fora do horário: variável `IGNORAR_HORARIO=1` na Vercel (remover depois).
- Chave Pix cadastrada na mesma conta Mercado Pago do `MP_ACCESS_TOKEN` (produção).
- Variáveis na Vercel: `MP_ACCESS_TOKEN`, `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (Production) + Redeploy após qualquer mudança.
- Commit no GitHub e redeploy da versão com Pix.
- Teste real: Pix pequeno de outro banco e estorno depois.
- Decisões comerciais: hospedagem paga (Vercel Pro/Supabase Pro), domínio próprio, preço do serviço.

## Como retomar numa nova sessão
1. Ler este arquivo e TODO.md. 2. `node tests/api.test.js` para confirmar o estado. 3. Seguir a "Próxima ação exata". 4. Não refazer itens concluídos.
