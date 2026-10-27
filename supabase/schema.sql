-- ============================================================
-- Dogão do Adriano — banco de dados (Supabase / Postgres)
-- Cole TUDO no Supabase: SQL Editor > New query > Run.
-- Pode rodar de novo sem medo: não apaga dados existentes.
-- ============================================================

create table if not exists public.categorias (
  id    text primary key,
  nome  text not null,
  ordem int  not null default 0
);

create table if not exists public.itens (
  id         text primary key,
  categoria  text not null references public.categorias(id),
  nome       text not null,
  descricao  text not null default '',
  preco      numeric(10,2) not null check (preco >= 0 and preco <= 5000),
  ativo      boolean not null default true,
  paes       text[],
  encomenda  text,
  verificar  boolean not null default false,
  ordem      int not null default 0
);

create table if not exists public.config (
  chave text primary key,
  valor jsonb not null
);

create table if not exists public.perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text not null,
  nome      text,
  telefone  text,
  endereco  text,
  role      text not null default 'cliente' check (role in ('cliente','admin')),
  criado_em timestamptz not null default now()
);

create table if not exists public.pedidos (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  user_id     uuid references auth.users(id) on delete set null,
  nome        text not null,
  telefone    text not null,
  tipo        text not null check (tipo in ('Delivery','Retirada')),
  endereco    text,
  obs         text,
  itens       jsonb not null,   -- [{id,nome,pao,q,preco}] com o preço da hora da compra
  subtotal    numeric(10,2) not null,
  taxa        numeric(10,2) not null default 0,
  total       numeric(10,2) not null,
  forma       text not null default 'online' check (forma in ('online','whatsapp')),
  status      text not null default 'aguardando_pagamento'
              check (status in ('aguardando_pagamento','a_combinar','recusado','pago','em_preparo','pronto','entregue','cancelado')),
  mp_payment_id text,
  mp_metodo   text,
  criado_em   timestamptz not null default now(),
  pago_em     timestamptz
);
create index if not exists pedidos_criado_idx on public.pedidos (criado_em desc);
create index if not exists pedidos_user_idx   on public.pedidos (user_id, criado_em desc);

create table if not exists public.auditoria (
  id        bigint generated always as identity primary key,
  quando    timestamptz not null default now(),
  quem      text not null,
  acao      text not null,
  detalhes  jsonb
);

-- Segurança: o navegador (chave anon) NÃO enxerga nada nestas tabelas.
-- Só o servidor do site (chave secreta) lê e grava, depois de checar login e papel.
alter table public.categorias enable row level security;
alter table public.itens      enable row level security;
alter table public.config     enable row level security;
alter table public.perfis     enable row level security;
alter table public.pedidos    enable row level security;
alter table public.auditoria  enable row level security;

-- Cria o perfil automaticamente quando alguém se cadastra.
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- Quem já se cadastrou antes de rodar este script também ganha perfil.
insert into public.perfis (id, email, nome)
select id, email, coalesce(raw_user_meta_data->>'nome', split_part(email,'@',1)) from auth.users
on conflict (id) do nothing;

insert into public.config (chave, valor) values ('taxa_entrega', '0'::jsonb)
on conflict (chave) do nothing;

-- Cardápio inicial (só entra se ainda não existir; não sobrescreve preços que você editar)
insert into public.categorias (id,nome,ordem) values ('tradicional','Tradicional',0) on conflict (id) do nothing;
insert into public.categorias (id,nome,ordem) values ('baguete','Baguete',1) on conflict (id) do nothing;
insert into public.categorias (id,nome,ordem) values ('prato','No Prato',2) on conflict (id) do nothing;
insert into public.categorias (id,nome,ordem) values ('prensado','Prensado',3) on conflict (id) do nothing;
insert into public.categorias (id,nome,ordem) values ('gigante','Baguete Gigante',4) on conflict (id) do nothing;
insert into public.categorias (id,nome,ordem) values ('adicionais','Adicionais',5) on conflict (id) do nothing;
insert into public.categorias (id,nome,ordem) values ('bebidas','Bebidas',6) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('t1','tradicional','Dogão Tradicional Completo','Pão, 2 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar, catupiry e queijo ralado.',11.00,array['Banha','Sal'],null,true,0) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('t2','tradicional','Dogão Tradicional Simples','Pão, 2 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup e purê de batata caseiro.',9.00,array['Banha','Sal'],null,true,1) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('t3','tradicional','Dogão Tradicional Kid''s Simples','Pão, 1 salsicha Sadia, catchup, batata palha e purê de batata caseiro.',7.00,array['Banha','Sal'],null,true,2) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('b10','baguete','Baguetão Tradicional','Pão, 2 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar e catupiry.',23.00,null,null,false,3) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('b11','baguete','Baguetão Prensado','Pão, 2 salsichas Sadia, bacon, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro e cheddar.',24.00,null,null,false,4) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('p15','prato','Dogão no Prato 15 cm (sem bacon)','Pão, 2 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar, catupiry e queijo ralado. Acompanha refrigerante pequeno de brinde.',15.00,null,null,true,5) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('p15b','prato','Dogão no Prato 15 cm (com bacon)','Igual ao 15 cm, com bacon. Acompanha refrigerante pequeno de brinde.',18.00,null,null,true,6) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('p21','prato','Dogão no Prato 21 cm (sem bacon)','Pão, 3 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar, catupiry e queijo ralado. Acompanha refrigerante pequeno de brinde.',17.00,null,null,true,7) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('p21b','prato','Dogão no Prato 21 cm (com bacon)','Igual ao 21 cm, com bacon. Acompanha refrigerante pequeno de brinde.',20.00,null,null,true,8) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('pr10','prensado','Pão de Banha ou Sal Prensado','Pão, 1 salsicha Sadia, bacon, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar, catupiry e queijo ralado.',11.00,array['Banha','Sal'],null,true,9) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('pr11','prensado','Dogão Kid''s Prensado','Pão, 1 salsicha Sadia, batata palha, purê de batata caseiro e catchup.',7.00,null,null,true,10) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('g60','gigante','Baguete Gigante 60 cm','Pão, 8 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar e catupiry.',80.00,null,'Sob encomenda',false,11) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('g100','gigante','Baguete Gigante 1 metro','Pão, 12 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar e catupiry. Consumo no local, por encomenda antecipada.',125.00,null,'Consumo no local, por encomenda antecipada',false,12) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('g200','gigante','Baguete Gigante 2 metros','Pão, 24 salsichas Sadia, milho, repolho, tomate, batata palha, maionese, mostarda, catchup, purê de batata caseiro, cheddar e catupiry. Consumo no local, por encomenda antecipada.',210.00,null,'Consumo no local, por encomenda antecipada',false,13) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('a1','adicionais','Bacon','Adicional para o seu dogão.',6.00,null,null,false,14) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('a2','adicionais','Purê','Adicional para o seu dogão.',6.00,null,null,false,15) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('a3','adicionais','Salsicha','Adicional para o seu dogão.',2.00,null,null,false,16) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('a4','adicionais','Queijo ralado','Adicional para o seu dogão.',2.00,null,null,false,17) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d1','bebidas','Lata 350 ml','Refrigerante em lata.',8.00,null,null,false,18) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d2','bebidas','Refrigerante 600 ml','',9.00,null,null,false,19) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d3','bebidas','Refrigerante 1 litro','',11.00,null,null,false,20) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d4','bebidas','Refrigerante 1,5 litro','',12.00,null,null,false,21) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d5','bebidas','Refrigerante 2 litros','',15.00,null,null,false,22) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d6','bebidas','Suco Del Valle 290 ml','',8.00,null,null,false,23) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d7','bebidas','Suco Life 300 ml','',8.00,null,null,false,24) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d8','bebidas','Suco Life 900 ml','',14.00,null,null,true,25) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d9','bebidas','Suco Life 1,7 litros','',18.00,null,null,true,26) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d10','bebidas','Cerveja lata 350 ml','Venda para maiores de 18 anos.',9.00,null,null,true,27) on conflict (id) do nothing;
insert into public.itens (id,categoria,nome,descricao,preco,paes,encomenda,verificar,ordem) values ('d11','bebidas','Água','',4.00,null,null,true,28) on conflict (id) do nothing;

-- ============================================================
-- PRIMEIRO ADMINISTRADOR
-- 1) Crie sua conta no site (botão Entrar > Criar conta) com o seu e-mail.
-- 2) Troque o e-mail abaixo pelo seu, apague os dois traços do início da
--    linha e rode só esta linha:
--
-- update public.perfis set role = 'admin' where email = 'SEU-EMAIL@exemplo.com';
-- ============================================================
