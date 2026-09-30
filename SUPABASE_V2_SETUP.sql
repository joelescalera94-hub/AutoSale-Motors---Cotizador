-- ================================================================
-- AUTOSALE MOTORS · BASE CENTRAL V2
-- ================================================================
-- Ejecutar completo en Supabase > SQL Editor.
-- Incluye:
--   • Auth/perfiles: administrador y asesor
--   • Vehículos compartidos + precios USD/Bs + catálogo público
--   • Configuración central del cotizador
--   • Clientes, visitas, permutas, seguimientos y cotizaciones
--   • Auditoría automática
--
-- IMPORTANTE:
-- 1) Crea primero al menos un usuario en Supabase Auth.
-- 2) Después de crear ese usuario, promuévelo a admin con el UPDATE
--    indicado al final de este archivo.
-- 3) Los demás usuarios creados normalmente quedan como asesores.
-- ================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- ROLES / PERFILES
-- ---------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'asesor');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.purchase_mode as enum ('contado', 'credito', 'garante_personal', 'hipotecario_vehicular', 'hipotecado_inmueble');
exception when duplicate_object then null;
end $$;

-- Compatibilidad al actualizar una instalación V2 existente.
alter type public.purchase_mode add value if not exists 'garante_personal';
alter type public.purchase_mode add value if not exists 'hipotecario_vehicular';
alter type public.purchase_mode add value if not exists 'hipotecado_inmueble';

do $$ begin
  create type public.client_status as enum ('nuevo', 'contactado', 'en_seguimiento', 'negociando', 'esperando_credito', 'esperando_permuta', 'vendido', 'perdido', 'pausado');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.tradein_review_status as enum ('pendiente', 'en_revision', 'revisado', 'rechazado');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'asesor',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_generic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_generic_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_user_role() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------
-- VEHÍCULOS + CATÁLOGO WEB
-- ---------------------------------------------------------------
create table if not exists public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  precio numeric(14,2) not null default 0 check (precio >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vehiculos add column if not exists precio_bs_manual numeric(14,2) check (precio_bs_manual is null or precio_bs_manual >= 0);
alter table public.vehiculos add column if not exists precio_bs_modo text not null default 'tipo_cambio';
alter table public.vehiculos add column if not exists estado_interno text not null default 'disponible';
alter table public.vehiculos add column if not exists public_published boolean not null default false;
alter table public.vehiculos add column if not exists public_featured boolean not null default false;
alter table public.vehiculos add column if not exists public_class text not null default 'minibus';
alter table public.vehiculos add column if not exists public_brand text not null default '';
alter table public.vehiculos add column if not exists public_model text not null default '';
alter table public.vehiculos add column if not exists public_version text not null default '';
alter table public.vehiculos add column if not exists public_engine text not null default '';
alter table public.vehiculos add column if not exists public_description text not null default '';
alter table public.vehiculos add column if not exists public_status text not null default 'nuevo';
alter table public.vehiculos add column if not exists public_variant text not null default '';
alter table public.vehiculos add column if not exists public_new boolean not null default false;
alter table public.vehiculos add column if not exists public_slug text;
alter table public.vehiculos add column if not exists public_image_url text;
alter table public.vehiculos add column if not exists public_gallery_urls text[] not null default '{}';
alter table public.vehiculos add column if not exists public_video_url text;
alter table public.vehiculos add column if not exists public_specs jsonb not null default '[]'::jsonb;

-- Compatibilidad con el esquema anterior.
create or replace function public.set_vehiculos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vehiculos_updated_at on public.vehiculos;
create trigger trg_vehiculos_updated_at
before update on public.vehiculos
for each row execute function public.set_vehiculos_updated_at();

create unique index if not exists uq_vehiculos_nombre_lower on public.vehiculos (lower(nombre));
create unique index if not exists uq_vehiculos_public_slug on public.vehiculos (public_slug) where public_slug is not null;
create index if not exists idx_vehiculos_nombre on public.vehiculos (lower(nombre));
create index if not exists idx_vehiculos_public on public.vehiculos (public_published, public_featured);

-- Vista pública: NO incluye precio USD/Bs ni ningún dato interno.
drop view if exists public.catalogo_publico;
create view public.catalogo_publico as
select
  id,
  public_slug as slug,
  public_class as clase,
  public_brand as marca,
  public_model as modelo,
  public_version as version,
  public_engine as motor,
  public_description as descripcion,
  public_status as estado,
  public_variant as variante,
  public_new as novedad,
  public_featured as destacado,
  public_image_url as imagen,
  public_gallery_urls as galeria,
  public_video_url as video,
  public_specs as especificaciones
from public.vehiculos
where public_published = true;

-- ---------------------------------------------------------------
-- CONFIGURACIÓN CENTRAL
-- ---------------------------------------------------------------
create table if not exists public.app_settings (
  id smallint primary key check (id = 1),
  tipo_cambio numeric(10,4) not null default 6.96 check (tipo_cambio > 0),
  tasa_interes_default numeric(6,3) not null default 16 check (tasa_interes_default >= 0),
  seguro_desgravamen numeric(6,3) not null default 1 check (seguro_desgravamen >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- CLIENTES
-- ---------------------------------------------------------------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  asesor_id uuid not null references public.profiles(id) on delete restrict,
  nombre_completo text not null,
  celular text not null,
  whatsapp text,
  origen text not null default 'Otro',
  vehiculo_interes_id uuid references public.vehiculos(id) on delete set null,
  modo_compra public.purchase_mode,
  presupuesto_usd numeric(14,2) check (presupuesto_usd is null or presupuesto_usd >= 0),
  estado public.client_status not null default 'en_seguimiento',
  notas text not null default '',
  motivo_perdida text,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clientes_asesor on public.clientes (asesor_id);
create index if not exists idx_clientes_estado on public.clientes (estado);
alter table public.clientes add column if not exists motivo_perdida text;

create index if not exists idx_clientes_celular on public.clientes (celular);

-- ---------------------------------------------------------------
-- VISITAS
-- ---------------------------------------------------------------
create table if not exists public.cliente_visitas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  fecha date not null default current_date,
  notas text not null default '',
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_visitas_cliente on public.cliente_visitas (cliente_id, fecha desc);

-- ---------------------------------------------------------------
-- PERMUTAS
-- ---------------------------------------------------------------
create table if not exists public.cliente_permutas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null unique references public.clientes(id) on delete cascade,
  marca text not null default '',
  modelo text not null default '',
  version text not null default '',
  anio integer,
  kilometraje integer,
  placa text,
  motor text,
  combustible text,
  transmision text,
  color text,
  valor_estimado numeric(14,2),
  valor_ofrecido numeric(14,2),
  estado_revision public.tradein_review_status not null default 'pendiente',
  pendientes_revision text[] not null default '{}',
  fotos text[] not null default '{}',
  decision text,
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_permutas_estado on public.cliente_permutas (estado_revision);

-- ---------------------------------------------------------------
-- SEGUIMIENTOS
-- ---------------------------------------------------------------
create table if not exists public.seguimientos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  asesor_id uuid not null references public.profiles(id) on delete restrict,
  tipo text not null default 'Llamada',
  programado_para timestamptz,
  estado text not null default 'pendiente',
  notas text not null default '',
  completado_at timestamptz,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seguimientos_asesor_fecha on public.seguimientos (asesor_id, programado_para);
create index if not exists idx_seguimientos_cliente on public.seguimientos (cliente_id, programado_para desc);

-- ---------------------------------------------------------------
-- COTIZACIONES
-- ---------------------------------------------------------------
create sequence if not exists public.cotizacion_numero_seq start 1001;

create table if not exists public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('public.cotizacion_numero_seq') unique,
  cliente_id uuid references public.clientes(id) on delete set null,
  asesor_id uuid not null references public.profiles(id) on delete restrict,
  vehiculo_id uuid references public.vehiculos(id) on delete set null,
  vehiculo_nombre text not null default '',
  precio_usd numeric(14,2) not null default 0,
  precio_bs numeric(14,2) not null default 0,
  cuota_inicial_usd numeric(14,2) not null default 0,
  monto_financiado_usd numeric(14,2) not null default 0,
  tasa_interes numeric(8,3) not null default 0,
  seguro_desgravamen numeric(8,3) not null default 0,
  plazo_anios numeric(6,2) not null default 0,
  cuota_mensual_usd numeric(14,2) not null default 0,
  cuota_mensual_bs numeric(14,2) not null default 0,
  notas text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_cotizaciones_asesor on public.cotizaciones (asesor_id, created_at desc);
create index if not exists idx_cotizaciones_cliente on public.cotizaciones (cliente_id, created_at desc);

-- ---------------------------------------------------------------
-- AUDITORÍA
-- ---------------------------------------------------------------
create table if not exists public.auditoria (
  id bigint generated by default as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  accion text not null,
  tabla text not null,
  registro_id uuid,
  detalles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_auditoria_fecha on public.auditoria (created_at desc);
create index if not exists idx_auditoria_actor on public.auditoria (actor_id, created_at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  payload jsonb;
begin
  rid := case when tg_op = 'DELETE' then old.id else new.id end;
  payload := jsonb_build_object(
    'operation', tg_op,
    'old', case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    'new', case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  insert into public.auditoria(actor_id, accion, tabla, registro_id, detalles)
  values (auth.uid(), lower(tg_op), tg_table_name, rid, payload);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Auditoría solo en tablas clave.
drop trigger if exists trg_audit_vehiculos on public.vehiculos;
create trigger trg_audit_vehiculos after insert or update or delete on public.vehiculos
for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_clientes on public.clientes;
create trigger trg_audit_clientes after insert or update or delete on public.clientes
for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_cotizaciones on public.cotizaciones;
create trigger trg_audit_cotizaciones after insert or update or delete on public.cotizaciones
for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_seguimientos on public.seguimientos;
create trigger trg_audit_seguimientos after insert or update or delete on public.seguimientos
for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------
-- RLS / GRANTS
-- ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.vehiculos enable row level security;
alter table public.app_settings enable row level security;
alter table public.clientes enable row level security;
alter table public.cliente_visitas enable row level security;
alter table public.cliente_permutas enable row level security;
alter table public.seguimientos enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.auditoria enable row level security;

-- Limpiar políticas anteriores relevantes para poder ejecutar el script otra vez.
do $$
begin
  execute 'drop policy if exists profiles_select on public.profiles';
  execute 'drop policy if exists profiles_update_admin on public.profiles';
  execute 'drop policy if exists profiles_insert_self on public.profiles';
  execute 'drop policy if exists profiles_update_self_or_admin on public.profiles';
  execute 'drop policy if exists profiles_insert_self on public.profiles';
  execute 'drop policy if exists profiles_update_self_or_admin on public.profiles';
  execute 'drop policy if exists vehiculos_select_public on public.vehiculos';
  execute 'drop policy if exists vehiculos_insert_public on public.vehiculos';
  execute 'drop policy if exists vehiculos_update_public on public.vehiculos';
  execute 'drop policy if exists vehiculos_delete_public on public.vehiculos';
  execute 'drop policy if exists vehiculos_select_auth on public.vehiculos';
  execute 'drop policy if exists vehiculos_insert_admin on public.vehiculos';
  execute 'drop policy if exists vehiculos_update_admin on public.vehiculos';
  execute 'drop policy if exists vehiculos_delete_admin on public.vehiculos';
  execute 'drop policy if exists settings_select_auth on public.app_settings';
  execute 'drop policy if exists settings_update_admin on public.app_settings';
  execute 'drop policy if exists settings_insert_admin on public.app_settings';
  execute 'drop policy if exists clientes_select on public.clientes';
  execute 'drop policy if exists clientes_insert on public.clientes';
  execute 'drop policy if exists clientes_update on public.clientes';
  execute 'drop policy if exists clientes_delete on public.clientes';
  execute 'drop policy if exists visitas_select on public.cliente_visitas';
  execute 'drop policy if exists visitas_insert on public.cliente_visitas';
  execute 'drop policy if exists visitas_update on public.cliente_visitas';
  execute 'drop policy if exists visitas_delete on public.cliente_visitas';
  execute 'drop policy if exists permutas_select on public.cliente_permutas';
  execute 'drop policy if exists permutas_insert on public.cliente_permutas';
  execute 'drop policy if exists permutas_update on public.cliente_permutas';
  execute 'drop policy if exists permutas_delete on public.cliente_permutas';
  execute 'drop policy if exists seguimientos_select on public.seguimientos';
  execute 'drop policy if exists seguimientos_insert on public.seguimientos';
  execute 'drop policy if exists seguimientos_update on public.seguimientos';
  execute 'drop policy if exists seguimientos_delete on public.seguimientos';
  execute 'drop policy if exists cotizaciones_select on public.cotizaciones';
  execute 'drop policy if exists cotizaciones_insert on public.cotizaciones';
  execute 'drop policy if exists cotizaciones_update on public.cotizaciones';
  execute 'drop policy if exists cotizaciones_delete on public.cotizaciones';
  execute 'drop policy if exists auditoria_select_admin on public.auditoria';
end $$;

-- Profiles
create policy profiles_select on public.profiles
for select to authenticated
using (auth.uid() = id or public.is_admin());

create policy profiles_update_admin on public.profiles
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Vehículos: leer para usuarios autenticados; escribir solo admin.
create policy vehiculos_select_auth on public.vehiculos
for select to authenticated using (true);
create policy vehiculos_insert_admin on public.vehiculos
for insert to authenticated with check (public.is_admin());
create policy vehiculos_update_admin on public.vehiculos
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy vehiculos_delete_admin on public.vehiculos
for delete to authenticated using (public.is_admin());

-- Configuración central
create policy settings_select_auth on public.app_settings
for select to authenticated using (true);
create policy settings_update_admin on public.app_settings
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_insert_admin on public.app_settings
for insert to authenticated with check (public.is_admin());

-- Clientes
create policy clientes_select on public.clientes
for select to authenticated
using (public.is_admin() or asesor_id = auth.uid());
create policy clientes_insert on public.clientes
for insert to authenticated
with check (public.is_admin() or asesor_id = auth.uid());
create policy clientes_update on public.clientes
for update to authenticated
using (public.is_admin() or asesor_id = auth.uid())
with check (public.is_admin() or asesor_id = auth.uid());
create policy clientes_delete on public.clientes
for delete to authenticated
using (public.is_admin() or asesor_id = auth.uid());

-- Visitas
create policy visitas_select on public.cliente_visitas
for select to authenticated
using (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));
create policy visitas_insert on public.cliente_visitas
for insert to authenticated
with check (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));
create policy visitas_update on public.cliente_visitas
for update to authenticated
using (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()))
with check (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));
create policy visitas_delete on public.cliente_visitas
for delete to authenticated
using (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));

-- Permutas
create policy permutas_select on public.cliente_permutas
for select to authenticated
using (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));
create policy permutas_insert on public.cliente_permutas
for insert to authenticated
with check (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));
create policy permutas_update on public.cliente_permutas
for update to authenticated
using (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()))
with check (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));
create policy permutas_delete on public.cliente_permutas
for delete to authenticated
using (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid()));

-- Seguimientos
create policy seguimientos_select on public.seguimientos
for select to authenticated
using (public.is_admin() or asesor_id = auth.uid());
create policy seguimientos_insert on public.seguimientos
for insert to authenticated
with check (public.is_admin() or asesor_id = auth.uid());
create policy seguimientos_update on public.seguimientos
for update to authenticated
using (public.is_admin() or asesor_id = auth.uid())
with check (public.is_admin() or asesor_id = auth.uid());
create policy seguimientos_delete on public.seguimientos
for delete to authenticated
using (public.is_admin() or asesor_id = auth.uid());

-- Cotizaciones
create policy cotizaciones_select on public.cotizaciones
for select to authenticated
using (public.is_admin() or asesor_id = auth.uid());
create policy cotizaciones_insert on public.cotizaciones
for insert to authenticated
with check (public.is_admin() or asesor_id = auth.uid());
create policy cotizaciones_update on public.cotizaciones
for update to authenticated
using (public.is_admin() or asesor_id = auth.uid())
with check (public.is_admin() or asesor_id = auth.uid());
create policy cotizaciones_delete on public.cotizaciones
for delete to authenticated
using (public.is_admin() or asesor_id = auth.uid());

-- Auditoría: solo admin lee; no se permite insert directo.
create policy auditoria_select_admin on public.auditoria
for select to authenticated using (public.is_admin());

-- Permisos mínimos.
revoke all on table public.vehiculos from anon;
revoke all on table public.app_settings from anon;
revoke all on table public.profiles from anon;
revoke all on table public.clientes from anon;
revoke all on table public.cliente_visitas from anon;
revoke all on table public.cliente_permutas from anon;
revoke all on table public.seguimientos from anon;
revoke all on table public.cotizaciones from anon;
revoke all on table public.auditoria from anon;

revoke all on table public.vehiculos from authenticated;
grant select, insert, update, delete on table public.vehiculos to authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.app_settings to authenticated;
grant select, insert, update, delete on table public.clientes to authenticated;
grant select, insert, update, delete on table public.cliente_visitas to authenticated;
grant select, insert, update, delete on table public.cliente_permutas to authenticated;
grant select, insert, update, delete on table public.seguimientos to authenticated;
grant select, insert, update, delete on table public.cotizaciones to authenticated;
grant usage, select on sequence public.cotizacion_numero_seq to authenticated;
grant select on table public.auditoria to authenticated;

grant select on public.catalogo_publico to anon, authenticated;

-- La vista pública sí puede ser leída sin login, pero solo contiene campos públicos.
-- No se concede SELECT de la tabla interna a anon.

-- Realtime: ejecuta si la tabla todavía no está en la publicación.
do $$
begin
  alter publication supabase_realtime add table public.vehiculos;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------
-- STORAGE · imágenes públicas del catálogo
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do update set public = true;

drop policy if exists catalogo_public_read on storage.objects;
drop policy if exists catalogo_admin_insert on storage.objects;
drop policy if exists catalogo_admin_update on storage.objects;
drop policy if exists catalogo_admin_delete on storage.objects;

create policy catalogo_public_read
on storage.objects for select
to public
using (bucket_id = 'catalogo');

create policy catalogo_admin_insert
on storage.objects for insert
to authenticated
with check (bucket_id = 'catalogo' and public.is_admin());

create policy catalogo_admin_update
on storage.objects for update
to authenticated
using (bucket_id = 'catalogo' and public.is_admin())
with check (bucket_id = 'catalogo' and public.is_admin());

create policy catalogo_admin_delete
on storage.objects for delete
to authenticated
using (bucket_id = 'catalogo' and public.is_admin());

-- ---------------------------------------------------------------
-- PASO FINAL: crear/prometer ADMIN
-- ---------------------------------------------------------------
-- 1) Crea el usuario administrador desde Supabase > Authentication > Users.
-- 2) Sustituye UUID_AQUI por su UUID y ejecuta:
--
-- update public.profiles
-- set role = 'admin', active = true, full_name = 'Administrador'
-- where id = 'UUID_AQUI';
--
-- Los usuarios nuevos creados por Auth quedan como asesores por defecto.
-- ---------------------------------------------------------------
