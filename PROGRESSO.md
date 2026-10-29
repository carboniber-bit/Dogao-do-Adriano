# PROGRESSO — Dogão do Adriano

> Estado real do projeto. Atualize junto com TODO.md ao fim de cada etapa. Nunca registre senhas, tokens ou chaves aqui.

## Objetivo geral
Site de pedidos do Dogão do Adriano (Osasco/SP) na Vercel + Supabase, com pagamento sem exigir conta no Mercado Pago:
Pix dentro do site (QR + copia e cola), cartão via Checkout Pro e pedido por WhatsApp (pagar na entrega). Avisos de pedido por Telegram.

## Decisões do dono
- 28/10: adicionais (categoria `adicionais`: Bacon, Purê, Salsicha, Queijo ralado) passam a ser escolhidos DENTRO do lanche (todos os lanches; nada de adicional avulso; bebidas sem adicionais; cada adicional 1x por lanche). Frete: manter a lista de bairros; sem API de distância por enquanto (reavaliar após semanas de pedidos reais). Dono vai passar os bairros/valores para eu montar o texto do `/admin`.
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
- Etapa C: `public/privacidade.html` (política LGPD em linguagem simples: dados coletados, finalidade, compartilhamento com Mercado Pago/Supabase/Vercel/Telegram/WhatsApp, cookies/localStorage, direitos, contato pelo WhatsApp público do site; afirma que o e-mail do Pix não é guardado). Links no rodapé e no texto do carrinho (`public/index.html`). Texto-modelo: dono deve revisar.
- Adicionais H1 (backend): `api/checkout.js` aceita `adds:[ids]` por linha (cada adicional 1x; só em lanche; bebidas/encomenda/avulso recusados com 400). Preço da linha = base + adicionais, do banco. Snapshot do pedido: `{id,nome,pao,q,preco(unit total),base,adds:[{id,nome,preco}]}` (jsonb, sem mudança de schema). Título no MP/Telegram: "Dogão (pão de sal) + Bacon". API 51/51.
- Adicionais H2 (site, `public/index.html`): adicionais saem das abas (categoria `adicionais` oculta) e viram janela "Quer adicionar algo ao seu lanche?" ao tocar em "+ Adicionar" (todos os lanches; bebidas/encomenda direto). Carrinho: chave `id|pão|adicionais`, linhas separadas por combinação, adicionais embaixo do nome, preço unitário com adicionais. Carrinho antigo no navegador: adicional avulso e adicional que sumiu são descartados. `Pedir de novo` leva os adicionais ainda ativos.
- Adicionais H3 (painel): `/admin` Pedidos mostra os adicionais de cada lanche (escapados); Cardápio e preços explica que adicionais aparecem dentro dos lanches. Navegador 29/29.
- Bot do Telegram criado e chat ID obtido pelo dono; variáveis colocadas na Vercel e redeploy feito.

## Arquivos alterados/criados na etapa Pix
- Novos: `api/_pagamento.js`, `api/pedido.js`, `tests/harness.js`, `tests/api.test.js`, `tests/browser.test.js`, `TODO.md`, `PROGRESSO.md`
- Alterados: `api/checkout.js` (modo pix; aviso do WhatsApp), `api/webhook.js` (refatorado), `public/index.html` (e-mail, botões, janela Pix, cabeçalho), `README.md`, `package.json` (scripts de teste)
- `public/admin/index.html`: sem mudança (já mostra `mp_metodo`).

## O que está funcionando (verificado)
- `node tests/api.test.js`: 51/51 passam.
- `node tests/browser.test.js`: 29/29 passam.
- Funções serverless: 7 (limite do plano gratuito: 12).

## Erros conhecidos / pontos em aberto
- Adicionais: cada adicional entra no máximo 1x por lanche (sem "bacon duplo"); para dobrar, o cliente escolhe mais de um lanche. Pedidos antigos (antes dos adicionais) não têm o campo `adds` (a tela trata como vazio).
- Pix real: o dono confirmou em 28/10 que o Pix está funcionando em produção (a recusa inicial "Collector user without key enabled" era falta de chave Pix na conta Mercado Pago; resolvido pelo dono). Também confirmados pelo dono em produção (28/10): aviso no Telegram, webhook (pagamento com a aba fechada), cartão (Checkout Pro) e estorno.
- Login: `/api/status` do dono devolveu `auth` preenchido (config OK); o site no ar já mostra o botão de conta (print de 28/10).
- Aviso de Telegram: agora cobre pagamento aprovado e pedidos por WhatsApp. Falta o dono publicar (commit + redeploy) para valer no site.
- Taxa por bairro é por lista de nomes (sem distância/mapa). Bairro vai embutido no texto do endereço (sem coluna própria no banco).
- Texto de horário no `/admin` > Resumo e no hero do site ("Peça aqui...") não mencionam horários; só o rodapé/faixa são dinâmicos.

## Testes executados e resultados
| Teste | Resultado |
|---|---|
| `node tests/api.test.js` | 51 passam, 0 falham (após adicionais) |
| `node tests/browser.test.js` | 29 passam (após adicionais) |

## Próxima ação exata
1. Dono: publicar a v7 (arquivos alterados: `api/checkout.js`, `public/index.html`, `public/admin/index.html`, `tests/*`, `TODO.md`, `PROGRESSO.md`, `README.md`) e testar um pedido com adicionais (Pix pequeno).
2. Dono envia a lista de bairros e valores; Claude monta o texto `Nome; valor` para colar no `/admin` > Cardápio e preços > Taxa por bairro.
3. Depois: custos/preço de venda (pesquisa com fontes; dono informa quanto pretende cobrar).
4. Antes de qualquer mudança: `node tests/api.test.js` e `node tests/browser.test.js`.

## Configurações externas que dependem do dono
- Publicar a v7: commit no GitHub + redeploy (sem SQL novo; os adicionais usam os itens/categoria que já existem). Não há SQL novo: horários e bairros usam a tabela `config` que já existe.
- Opcional no `/admin`: cadastrar horários reais e bairros (se quiser taxa por bairro), clicar em "Som" para ativar o alerta.
- Para testar fora do horário: variável `IGNORAR_HORARIO=1` na Vercel (remover depois).
- Chave Pix cadastrada na mesma conta Mercado Pago do `MP_ACCESS_TOKEN` (produção).
- Variáveis na Vercel: `MP_ACCESS_TOKEN`, `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (Production) + Redeploy após qualquer mudança.
- Commit no GitHub e redeploy da versão com Pix.
- Teste real: Pix pequeno de outro banco e estorno depois.
- Decisões comerciais: hospedagem paga (Vercel Pro/Supabase Pro), domínio próprio, preço do serviço.

## Versão no ar
- v5 publicada pelo dono em 28/10 (repositório GitHub, branch `main`, deploy na Vercel). Upload manual: 23 de 24 arquivos (falta só o `.gitignore`, sem efeito no site).

## Como retomar numa nova sessão
1. Ler este arquivo e TODO.md. 2. `node tests/api.test.js` para confirmar o estado. 3. Seguir a "Próxima ação exata". 4. Não refazer itens concluídos.
