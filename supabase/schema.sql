-- Archivo: /supabase/schema.sql
-- Esquema completo de Stocki: tablas, funciones, vista de catálogo, RLS,
-- Storage y datos semilla. Ejecutar COMPLETO en el editor SQL de Supabase.
-- El script es re-ejecutable: usa IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.

-- ============================================================
-- 1. TABLAS
-- ============================================================

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- profiles extiende auth.users; el rol define los permisos de escritura.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  phone      text,
  role       text not null default 'buyer' check (role in ('buyer', 'seller', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- seller_id es NULL solo en los productos semilla (catálogo "de la casa").
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid references public.profiles (id) on delete set null,
  category_id      uuid references public.categories (id) on delete set null,
  title            text not null check (char_length(title) between 3 and 150),
  description      text not null default '',
  price            numeric(14, 2) not null check (price >= 0),
  cost_price       numeric(14, 2) check (cost_price >= 0),
  stock            integer not null default 0 check (stock >= 0),
  images           text[] not null default '{}',
  free_shipping    boolean not null default false,
  source           text not null default 'manual' check (source in ('manual', 'dropi')),
  dropi_product_id text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  buyer_id         uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'pendiente'
                   check (status in ('pendiente', 'pagada', 'enviada', 'entregada', 'cancelada')),
  total            numeric(14, 2) not null check (total >= 0),
  shipping_address jsonb not null default '{}'::jsonb,
  payment_gateway  text check (payment_gateway in ('bold', 'mercadopago')),
  -- Resultado del despacho automático a Dropi (id de orden del proveedor, etc.)
  fulfillment      jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Snapshot de título/precio por ítem: el historial sobrevive a ediciones del
-- producto. seller_id habilita el futuro reparto de cobros por vendedor.
create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  seller_id  uuid references public.profiles (id) on delete set null,
  title      text not null,
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  quantity   integer not null check (quantity > 0),
  subtotal   numeric(14, 2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  gateway            text not null check (gateway in ('bold', 'mercadopago')),
  external_reference text,
  amount             numeric(14, 2) not null default 0,
  status             text not null default 'pendiente'
                     check (status in ('pendiente', 'aprobado', 'rechazado', 'reembolsado')),
  webhook_payload    jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Prevista para la etapa de cobros independientes por vendedor.
-- Antes de usarla en producción, cifrar credentials con Supabase Vault.
create table if not exists public.seller_payment_accounts (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  gateway     text not null check (gateway in ('bold', 'mercadopago')),
  credentials jsonb not null default '{}'::jsonb,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (seller_id, gateway)
);

-- Carrito persistente del usuario autenticado (los invitados usan localStorage).
create table if not exists public.cart_items (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity   integer not null check (quantity > 0),
  primary key (user_id, product_id)
);

-- Índices para las rutas de consulta más frecuentes
create index if not exists idx_products_seller on public.products (seller_id);
create index if not exists idx_products_category on public.products (category_id);
create index if not exists idx_products_active on public.products (active);
create index if not exists idx_orders_buyer on public.orders (buyer_id);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_seller on public.order_items (seller_id);
create index if not exists idx_payments_order on public.payments (order_id);
create unique index if not exists idx_payments_gateway_ref
  on public.payments (gateway, external_reference)
  where external_reference is not null;

-- ============================================================
-- 2. FUNCIONES AUXILIARES
-- ============================================================

-- SECURITY DEFINER: consultan profiles/orders/order_items sin activar RLS,
-- lo que evita la recursión infinita entre políticas que se referencian.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_seller()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('seller', 'admin')
  );
$$;

create or replace function public.is_order_buyer(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.orders
    where id = p_order_id and buyer_id = auth.uid()
  );
$$;

-- Solo para el INSERT de order_items: la orden debe seguir pendiente y sin
-- ningún intento de pago registrado (evita inflar órdenes ya cobradas o en
-- proceso de cobro con ítems no pagados).
create or replace function public.is_pending_order_of_buyer(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.buyer_id = auth.uid()
      and o.status = 'pendiente'
      and not exists (select 1 from public.payments p where p.order_id = o.id)
  );
$$;

create or replace function public.is_seller_of_order(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.order_items
    where order_id = p_order_id and seller_id = auth.uid()
  );
$$;

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_updated on public.payments;
create trigger trg_payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

-- Crea el perfil automáticamente al registrarse un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Regla de roles: un usuario solo puede subirse de buyer a seller; los demás
-- cambios exigen admin, secret key (service role) o el editor SQL del dashboard.
create or replace function public.enforce_role_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if (select auth.role()) = 'service_role'
       or current_user in ('postgres', 'supabase_admin')
       or public.is_admin()
       or (old.role = 'buyer' and new.role = 'seller' and auth.uid() = old.id) then
      return new;
    end if;
    raise exception 'Cambio de rol no permitido';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_role_guard on public.profiles;
create trigger trg_profiles_role_guard before update on public.profiles
  for each row execute function public.enforce_role_rules();

-- Guarda de columnas y transiciones de orders: el comprador solo puede
-- cancelar (nunca tocar total/fulfillment/dirección tras crear la orden), y
-- nadie marca enviada/entregada sin pago confirmado.
create or replace function public.enforce_order_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_privileged boolean;
begin
  v_privileged := (select auth.role()) = 'service_role'
                  or current_user in ('postgres', 'supabase_admin')
                  or public.is_admin();

  if not v_privileged then
    if new.total is distinct from old.total
       or new.buyer_id is distinct from old.buyer_id
       or new.fulfillment is distinct from old.fulfillment
       or new.shipping_address is distinct from old.shipping_address
       or new.payment_gateway is distinct from old.payment_gateway then
      raise exception 'Solo puedes cancelar tu orden; el resto de campos no se pueden modificar';
    end if;
  end if;

  if old.status = 'pendiente' and new.status in ('enviada', 'entregada') then
    raise exception 'La orden no puede marcarse % sin un pago confirmado', new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_guard on public.orders;
create trigger trg_orders_guard before update on public.orders
  for each row execute function public.enforce_order_rules();

-- Confirmación de pago: SOLO la invoca el webhook (secret key). Idempotente:
-- únicamente transiciona pendiente -> pagada y descuenta stock una sola vez.
create or replace function public.mark_order_paid(p_order_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_item record;
begin
  -- Defensa en profundidad: los ítems deben cuadrar con el total cobrado;
  -- si alguien manipuló la orden, no se confirma nada.
  if (select coalesce(sum(subtotal), 0) from public.order_items where order_id = p_order_id)
     is distinct from (select total from public.orders where id = p_order_id) then
    raise warning 'mark_order_paid: total inconsistente para la orden %', p_order_id;
    return false;
  end if;

  update public.orders
  set status = 'pagada'
  where id = p_order_id and status = 'pendiente';

  if not found then
    return false;
  end if;

  for v_item in
    select product_id, quantity
    from public.order_items
    where order_id = p_order_id and product_id is not null
  loop
    update public.products
    set stock = greatest(stock - v_item.quantity, 0)
    where id = v_item.product_id;
  end loop;

  return true;
end;
$$;

revoke execute on function public.mark_order_paid(uuid) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid) to service_role;

-- ============================================================
-- 3. VISTA PÚBLICA DE CATÁLOGO
-- ============================================================
-- Vista con semántica DEFINER (intencional, pese al aviso del linter):
-- expone SOLO columnas seguras de productos activos + nombre del vendedor.
-- Así cost_price y dropi_product_id nunca llegan al navegador de terceros.

create or replace view public.catalog_products as
select
  p.id,
  p.title,
  p.description,
  p.price,
  p.stock,
  p.images,
  p.free_shipping,
  p.source,
  p.category_id,
  c.name  as category_name,
  c.slug  as category_slug,
  p.seller_id,
  coalesce(pr.full_name, 'Stocki') as seller_name,
  p.created_at
from public.products p
left join public.categories c on c.id = p.category_id
left join public.profiles pr on pr.id = p.seller_id
where p.active = true;

grant select on public.catalog_products to anon, authenticated;

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.seller_payment_accounts enable row level security;
alter table public.cart_items enable row level security;

-- --- categories: lectura pública, escritura solo admin
drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories
  for select using (true);

drop policy if exists "categories_admin_write" on public.categories;
create policy "categories_admin_write" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- --- profiles: cada quien ve/edita el suyo; admin todo
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- --- products: la navegación pública usa la vista catalog_products.
--     El acceso directo a la tabla es solo del dueño o del admin.
drop policy if exists "products_select_owner_or_admin" on public.products;
create policy "products_select_owner_or_admin" on public.products
  for select using (seller_id = auth.uid() or public.is_admin());

drop policy if exists "products_insert_seller" on public.products;
create policy "products_insert_seller" on public.products
  for insert with check (seller_id = auth.uid() and public.is_seller());

drop policy if exists "products_update_owner_or_admin" on public.products;
create policy "products_update_owner_or_admin" on public.products
  for update using (seller_id = auth.uid() or public.is_admin())
  with check (seller_id = auth.uid() or public.is_admin());

drop policy if exists "products_delete_owner_or_admin" on public.products;
create policy "products_delete_owner_or_admin" on public.products
  for delete using (seller_id = auth.uid() or public.is_admin());

-- --- orders
drop policy if exists "orders_select_involved" on public.orders;
create policy "orders_select_involved" on public.orders
  for select using (
    buyer_id = auth.uid()
    or public.is_admin()
    or public.is_seller_of_order(id)
  );

drop policy if exists "orders_insert_buyer_pending" on public.orders;
create policy "orders_insert_buyer_pending" on public.orders
  for insert with check (
    buyer_id = auth.uid() and status = 'pendiente' and fulfillment is null
  );

-- El comprador solo puede cancelar una orden aún pendiente
drop policy if exists "orders_update_buyer_cancel" on public.orders;
create policy "orders_update_buyer_cancel" on public.orders
  for update using (buyer_id = auth.uid() and status = 'pendiente')
  with check (buyer_id = auth.uid() and status in ('pendiente', 'cancelada'));

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

-- --- order_items
drop policy if exists "order_items_select_involved" on public.order_items;
create policy "order_items_select_involved" on public.order_items
  for select using (
    seller_id = auth.uid()
    or public.is_admin()
    or public.is_order_buyer(order_id)
  );

-- El ítem debe pertenecer a una orden pendiente del comprador SIN pagos en
-- curso, y su seller_id debe coincidir con el dueño real del producto
-- (validado vía la vista, que no está sujeta al RLS de products).
-- Nota: order_items.seller_id va calificado; sin calificar se resolvería
-- contra cp.seller_id y la comparación sería una tautología.
drop policy if exists "order_items_insert_buyer" on public.order_items;
create policy "order_items_insert_buyer" on public.order_items
  for insert with check (
    public.is_pending_order_of_buyer(order_id)
    and exists (
      select 1 from public.catalog_products cp
      where cp.id = product_id
        and cp.seller_id is not distinct from order_items.seller_id
    )
  );

-- --- payments: solo lectura para el comprador involucrado y el admin.
--     Sin políticas de escritura: únicamente la secret key (webhooks) escribe.
drop policy if exists "payments_select_involved" on public.payments;
create policy "payments_select_involved" on public.payments
  for select using (public.is_admin() or public.is_order_buyer(order_id));

-- --- seller_payment_accounts: cada vendedor gestiona la suya; admin todo
drop policy if exists "spa_select_owner_or_admin" on public.seller_payment_accounts;
create policy "spa_select_owner_or_admin" on public.seller_payment_accounts
  for select using (seller_id = auth.uid() or public.is_admin());

drop policy if exists "spa_insert_owner" on public.seller_payment_accounts;
create policy "spa_insert_owner" on public.seller_payment_accounts
  for insert with check (seller_id = auth.uid() and public.is_seller());

drop policy if exists "spa_update_owner_or_admin" on public.seller_payment_accounts;
create policy "spa_update_owner_or_admin" on public.seller_payment_accounts
  for update using (seller_id = auth.uid() or public.is_admin())
  with check (seller_id = auth.uid() or public.is_admin());

drop policy if exists "spa_delete_owner_or_admin" on public.seller_payment_accounts;
create policy "spa_delete_owner_or_admin" on public.seller_payment_accounts
  for delete using (seller_id = auth.uid() or public.is_admin());

-- --- cart_items: estrictamente personal
drop policy if exists "cart_items_all_own" on public.cart_items;
create policy "cart_items_all_own" on public.cart_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- 5. STORAGE: bucket product-images
-- ============================================================
-- Lectura pública; escritura solo para vendedores dentro de su carpeta
-- (la ruta de cada archivo empieza por su auth.uid()).

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "stocki_product_images_read" on storage.objects;
create policy "stocki_product_images_read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "stocki_product_images_insert" on storage.objects;
create policy "stocki_product_images_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-images'
    and public.is_seller()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "stocki_product_images_update" on storage.objects;
create policy "stocki_product_images_update" on storage.objects
  for update to authenticated using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "stocki_product_images_delete" on storage.objects;
create policy "stocki_product_images_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 6. DATOS SEMILLA (3 categorías, 12 productos)
-- ============================================================

insert into public.categories (name, slug) values
  ('Tecnología', 'tecnologia'),
  ('Hogar', 'hogar'),
  ('Deportes', 'deportes')
on conflict (slug) do nothing;

do $$
begin
  if not exists (select 1 from public.products) then
    insert into public.products
      (title, description, category_id, price, stock, images, free_shipping)
    values
      ('Audífonos inalámbricos Bluetooth 5.3',
       'Audífonos in-ear con cancelación de ruido, estuche de carga y 30 horas de batería total. Resistencia al agua IPX4.',
       (select id from public.categories where slug = 'tecnologia'), 129900, 25,
       array['https://picsum.photos/seed/stocki-audifonos/600/600'], true),
      ('Smartwatch deportivo con GPS',
       'Reloj inteligente con GPS integrado, monitoreo de ritmo cardíaco, oxígeno en sangre y más de 100 modos deportivos.',
       (select id from public.categories where slug = 'tecnologia'), 349900, 15,
       array['https://picsum.photos/seed/stocki-smartwatch/600/600'], true),
      ('Teclado mecánico RGB switch red',
       'Teclado mecánico 60% con switches red, retroiluminación RGB personalizable y keycaps double-shot.',
       (select id from public.categories where slug = 'tecnologia'), 189900, 30,
       array['https://picsum.photos/seed/stocki-teclado/600/600'], false),
      ('Cámara de seguridad WiFi 2K',
       'Cámara IP con visión nocturna, detección de movimiento, audio bidireccional y almacenamiento en la nube o microSD.',
       (select id from public.categories where slug = 'tecnologia'), 159900, 20,
       array['https://picsum.photos/seed/stocki-camara/600/600'], true),
      ('Juego de sábanas 300 hilos queen',
       'Juego de sábanas de microfibra premium 300 hilos: ajustable, plana y dos fundas de almohada. Suaves e hipoalergénicas.',
       (select id from public.categories where slug = 'hogar'), 89900, 40,
       array['https://picsum.photos/seed/stocki-sabanas/600/600'], false),
      ('Licuadora de vaso 1200 W',
       'Licuadora de alta potencia con vaso de vidrio de 1.5 L, 5 velocidades, función pulso y cuchillas de acero inoxidable.',
       (select id from public.categories where slug = 'hogar'), 219900, 12,
       array['https://picsum.photos/seed/stocki-licuadora/600/600'], true),
      ('Lámpara LED de escritorio táctil',
       'Lámpara de escritorio con 3 temperaturas de color, brillo regulable, puerto USB de carga y brazo plegable.',
       (select id from public.categories where slug = 'hogar'), 59900, 50,
       array['https://picsum.photos/seed/stocki-lampara/600/600'], false),
      ('Organizador de cocina 4 niveles',
       'Estante organizador multiusos de acero con 4 niveles, ideal para especias, frascos y utensilios. Fácil de armar.',
       (select id from public.categories where slug = 'hogar'), 45900, 35,
       array['https://picsum.photos/seed/stocki-organizador/600/600'], false),
      ('Balón de fútbol profesional N.º 5',
       'Balón cosido a máquina tamaño 5, cubierta de PU resistente a la abrasión, cámara de butilo para mejor retención de aire.',
       (select id from public.categories where slug = 'deportes'), 79900, 45,
       array['https://picsum.photos/seed/stocki-balon/600/600'], false),
      ('Par de mancuernas recubiertas 10 kg',
       'Mancuernas hexagonales de 5 kg cada una con recubrimiento de neopreno antideslizante. Ideales para entrenar en casa.',
       (select id from public.categories where slug = 'deportes'), 119900, 18,
       array['https://picsum.photos/seed/stocki-mancuernas/600/600'], true),
      ('Bicicleta estática plegable',
       'Bicicleta estática con 8 niveles de resistencia magnética, pantalla LCD, sensor de pulso y diseño plegable para ahorrar espacio.',
       (select id from public.categories where slug = 'deportes'), 999900, 8,
       array['https://picsum.photos/seed/stocki-bicicleta/600/600'], true),
      ('Colchoneta de yoga antideslizante 6 mm',
       'Mat de yoga de TPE ecológico de 6 mm con doble cara antideslizante y correa de transporte incluida.',
       (select id from public.categories where slug = 'deportes'), 39900, 60,
       array['https://picsum.photos/seed/stocki-colchoneta/600/600'], false);
  end if;
end $$;

-- ============================================================
-- 7. POST-INSTALACIÓN (manual)
-- ============================================================
-- Tras registrar tu usuario en la web, conviértelo en admin y reclama los
-- productos semilla ejecutando (reemplaza el correo):
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'TU_CORREO_ADMIN');
--
--   update public.products set seller_id =
--     (select id from auth.users where email = 'TU_CORREO_ADMIN')
--   where seller_id is null;
