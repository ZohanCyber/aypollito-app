-- Ay Pollito — esquema de base de datos (Supabase / Postgres)
-- Ejecutar una vez en: Supabase → SQL Editor → New query → Run

create extension if not exists pgcrypto;

-- Productos del menú
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  price       numeric(10,2) not null default 0 check (price >= 0),
  available   boolean not null default true,
  position    integer not null default 0,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- Pedidos
create table if not exists orders (
  id           uuid primary key,
  number       integer not null unique,
  customer     text not null default 'Sin nombre',
  service      text not null check (service in ('llevar','domicilio')),
  address      text not null default '',
  status       text not null default 'prep' check (status in ('prep','listo','entregado','cancelado')),
  total        numeric(10,2) not null default 0,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_status_idx on orders (status);

-- Renglones de cada pedido
create table if not exists order_items (
  id        bigserial primary key,
  order_id  uuid not null references orders(id) on delete cascade,
  name      text not null,
  qty       integer not null check (qty > 0),
  price     numeric(10,2) not null
);
create index if not exists order_items_order_idx on order_items (order_id);

-- Ajustes (PIN hasheado, etc.)
create table if not exists settings (
  key   text primary key,
  value text not null
);

-- Seguridad: sólo usuarios autenticados (la cuenta del negocio) pueden leer/escribir.
alter table products    enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;
alter table settings    enable row level security;

drop policy if exists "staff all" on products;
drop policy if exists "staff all" on orders;
drop policy if exists "staff all" on order_items;
drop policy if exists "staff all" on settings;

create policy "staff all" on products    for all to authenticated using (true) with check (true);
create policy "staff all" on orders      for all to authenticated using (true) with check (true);
create policy "staff all" on order_items for all to authenticated using (true) with check (true);
create policy "staff all" on settings    for all to authenticated using (true) with check (true);

-- Menú inicial (edítalo después desde la app)
insert into products (name, price, position) values
  ('Pollo entero',    180, 1),
  ('Medio pollo',      95, 2),
  ('Cuarto de pollo',  55, 3),
  ('Pechuga',          70, 4),
  ('Pierna y muslo',   60, 5),
  ('Ensalada',         25, 6),
  ('Salsa extra',      10, 7),
  ('Refresco 600 ml',  22, 8)
on conflict do nothing;
