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
alter table public.vehiculos add column if not exists public_published boolean not null default true;
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
alter table public.vehiculos add column if not exists public_offer boolean not null default false;
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
  public_offer as oferta,
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
  origen text not null default 'Visita por concesionaria',
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
  cliente_id uuid not null references public.clientes(id) on delete cascade,
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
create index if not exists idx_permutas_cliente on public.cliente_permutas (cliente_id, created_at);

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


-- ================================================================
-- EXTENSION V2.4 INCLUIDA PARA INSTALACIONES NUEVAS
-- ================================================================
-- ================================================================
-- AUTOSALE MOTORS · PATCH V2.4
-- Ejecutar UNA VEZ (es idempotente) en Supabase > SQL Editor.
-- Añade edición/borrado recuperable, Bs completos, archivo de clientes,
-- historial de reasignaciones y soporte Realtime para CRM.
-- ================================================================

-- 1) Campos nuevos ------------------------------------------------
alter table public.clientes
  add column if not exists archived_at timestamptz;

alter table public.seguimientos
  add column if not exists deleted_at timestamptz;

alter table public.cotizaciones
  add column if not exists cuota_inicial_bs numeric(14,2) not null default 0,
  add column if not exists monto_financiado_bs numeric(14,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

create index if not exists idx_clientes_archived_at on public.clientes (archived_at);
create index if not exists idx_seguimientos_deleted_at on public.seguimientos (deleted_at);
create index if not exists idx_cotizaciones_deleted_at on public.cotizaciones (deleted_at);

-- Completar Bs en cotizaciones antiguas usando el tipo de cambio central
update public.cotizaciones q
set
  cuota_inicial_bs = case when coalesce(q.cuota_inicial_bs,0)=0 then round(q.cuota_inicial_usd * s.tipo_cambio) else q.cuota_inicial_bs end,
  monto_financiado_bs = case when coalesce(q.monto_financiado_bs,0)=0 then round(q.monto_financiado_usd * s.tipo_cambio) else q.monto_financiado_bs end
from public.app_settings s
where s.id=1
  and (coalesce(q.cuota_inicial_bs,0)=0 or coalesce(q.monto_financiado_bs,0)=0);

-- 2) updated_at automático ----------------------------------------
drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
before update on public.clientes
for each row execute function public.set_generic_updated_at();

drop trigger if exists trg_permutas_updated_at on public.cliente_permutas;
create trigger trg_permutas_updated_at
before update on public.cliente_permutas
for each row execute function public.set_generic_updated_at();

drop trigger if exists trg_seguimientos_updated_at on public.seguimientos;
create trigger trg_seguimientos_updated_at
before update on public.seguimientos
for each row execute function public.set_generic_updated_at();

drop trigger if exists trg_cotizaciones_updated_at on public.cotizaciones;
create trigger trg_cotizaciones_updated_at
before update on public.cotizaciones
for each row execute function public.set_generic_updated_at();

-- 3) Historial de reasignación ------------------------------------
create table if not exists public.cliente_asignaciones (
  id bigint generated by default as identity primary key,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  anterior_id uuid references public.profiles(id) on delete set null,
  nuevo_id uuid references public.profiles(id) on delete set null,
  cambiado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_cliente_asignaciones_cliente on public.cliente_asignaciones (cliente_id, created_at desc);

create or replace function public.log_cliente_reasignacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.asesor_id is distinct from new.asesor_id then
    insert into public.cliente_asignaciones(cliente_id, anterior_id, nuevo_id, cambiado_por)
    values(new.id, old.asesor_id, new.asesor_id, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cliente_reasignacion on public.clientes;
create trigger trg_cliente_reasignacion
after update of asesor_id on public.clientes
for each row execute function public.log_cliente_reasignacion();

alter table public.cliente_asignaciones enable row level security;
drop policy if exists cliente_asignaciones_select on public.cliente_asignaciones;
create policy cliente_asignaciones_select on public.cliente_asignaciones
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.clientes c
    where c.id = cliente_id and c.asesor_id = auth.uid()
  )
);
revoke all on table public.cliente_asignaciones from anon;
grant select on table public.cliente_asignaciones to authenticated;

-- 4) Al marcar vendido, cerrar seguimientos vigentes --------------
create or replace function public.close_followups_when_sold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'vendido' and old.estado is distinct from new.estado then
    update public.seguimientos
    set estado='completado', completado_at=coalesce(completado_at, now())
    where cliente_id=new.id
      and estado='pendiente'
      and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_close_followups_when_sold on public.clientes;
create trigger trg_close_followups_when_sold
after update of estado on public.clientes
for each row execute function public.close_followups_when_sold();

-- 5) Realtime para el CRM -----------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.clientes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.seguimientos;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.cotizaciones;
exception when duplicate_object then null;
end $$;

-- Fin del patch V2.4


-- ================================================================
-- CAMPOS Y REGLAS AÑADIDOS EN LA VERSIÓN V2.5
-- ================================================================
-- ================================================================
-- AUTOSALE MOTORS · PATCH V2.5
-- Ejecutar UNA VEZ (es idempotente) en Supabase > SQL Editor.
--
-- Incluye:
--   • contraseña temporal obligatoria para asesores
--   • parámetros centrales: desgravamen + seguros
--   • datos financieros V2.5 en cotizaciones
--   • una sola cotización por cliente + vehículo (se actualiza al guardar)
--   • borrado de cliente en cascada sobre sus cotizaciones
--
-- NO elimina vehículos ni clientes activos.
-- ================================================================

begin;

-- 1) Perfiles -----------------------------------------------------
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- 2) Configuración financiera central -----------------------------
alter table public.app_settings
  add column if not exists seguro_vehicular_mensual numeric(12,2) not null default 700 check (seguro_vehicular_mensual >= 0),
  add column if not exists seguro_inmueble_mensual numeric(12,2) not null default 150 check (seguro_inmueble_mensual >= 0);

-- En V2.5 seguro_desgravamen representa % MENSUAL sobre saldo deudor.
-- Referencia operativa acordada: 0,083% mensual.
update public.app_settings
set seguro_desgravamen = 0.083,
    seguro_vehicular_mensual = coalesce(seguro_vehicular_mensual, 700),
    seguro_inmueble_mensual = coalesce(seguro_inmueble_mensual, 150)
where id = 1;

-- Campo legado de V2.4 que sigue usándose para ignorar registros archivados.
alter table public.clientes
  add column if not exists archived_at timestamptz;

-- 3) Duplicados de clientes por celular ----------------------------
-- El asesor no necesita ver la cartera de otro usuario para recibir un aviso:
-- el trigger valida el celular a nivel de base de datos.
create schema if not exists private;

create or replace function private.prevent_duplicate_client_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_phone text;
  duplicate_exists boolean;
begin
  normalized_phone := regexp_replace(coalesce(new.celular, ''), '[^0-9]', '', 'g');
  if normalized_phone = '' then
    return new;
  end if;

  select exists (
    select 1
    from public.clientes c
    where c.id is distinct from new.id
      and c.archived_at is null
      and regexp_replace(coalesce(c.celular, ''), '[^0-9]', '', 'g') = normalized_phone
  ) into duplicate_exists;

  if duplicate_exists then
    raise exception using errcode = '23505', message = 'CLIENT_PHONE_ALREADY_EXISTS';
  end if;

  return new;
end;
$$;

revoke execute on function private.prevent_duplicate_client_phone() from public, anon, authenticated;

drop trigger if exists trg_clientes_unique_phone on public.clientes;
create trigger trg_clientes_unique_phone
before insert or update of celular on public.clientes
for each row execute function private.prevent_duplicate_client_phone();

-- 4) Compatibilidad con V2.4 y campos V2.5 -----------------------
alter table public.seguimientos
  add column if not exists deleted_at timestamptz;

alter table public.cotizaciones
  add column if not exists cuota_inicial_bs numeric(14,2) not null default 0,
  add column if not exists monto_financiado_bs numeric(14,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists modalidad_compra text,
  add column if not exists desgravamen_estimado_bs numeric(14,2) not null default 0,
  add column if not exists seguro_vehicular_bs numeric(14,2) not null default 0,
  add column if not exists seguro_inmueble_bs numeric(14,2) not null default 0,
  add column if not exists cuota_financiera_bs numeric(14,2) not null default 0,
  add column if not exists cuota_total_bs numeric(14,2) not null default 0;

-- updated_at automático (la función ya existe desde V2; si el hardening la
-- movió al schema private, usamos la que exista).
drop trigger if exists trg_cotizaciones_updated_at on public.cotizaciones;
do $$
begin
  if to_regprocedure('private.set_generic_updated_at()') is not null then
    execute 'create trigger trg_cotizaciones_updated_at before update on public.cotizaciones for each row execute function private.set_generic_updated_at()';
  elsif to_regprocedure('public.set_generic_updated_at()') is not null then
    execute 'create trigger trg_cotizaciones_updated_at before update on public.cotizaciones for each row execute function public.set_generic_updated_at()';
  end if;
end;
$$;

-- 5) Una cotización vigente por cliente + vehículo ----------------
-- Si existían duplicados históricos activos, conservamos el más reciente.
with ranked as (
  select id,
         row_number() over (
           partition by cliente_id, vehiculo_id
           order by coalesce(updated_at, created_at) desc, numero desc
         ) as rn
  from public.cotizaciones
  where cliente_id is not null
    and vehiculo_id is not null
    and deleted_at is null
)
delete from public.cotizaciones q
using ranked r
where q.id = r.id and r.rn > 1;

create unique index if not exists uq_cotizaciones_cliente_vehiculo_activa
on public.cotizaciones (cliente_id, vehiculo_id)
where cliente_id is not null and vehiculo_id is not null and deleted_at is null;

-- 6) Al eliminar un cliente, sus cotizaciones también se eliminan --------
do $$
declare
  fk_name text;
begin
  for fk_name in
    select conname
    from pg_constraint
    where conrelid = 'public.cotizaciones'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (cliente_id)%'
  loop
    execute format('alter table public.cotizaciones drop constraint %I', fk_name);
  end loop;
end;
$$;

alter table public.cotizaciones
  add constraint cotizaciones_cliente_id_fkey
  foreign key (cliente_id) references public.clientes(id) on delete cascade;

-- 7) Realtime de configuración y estado de usuarios ----------------
do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end;
$$;

commit;


-- ================================================================
-- MIGRACIÓN ACTUAL / CONFIGURACIÓN FINAL
-- ================================================================
-- ================================================================
-- AUTOSALE MOTORS · MIGRACIÓN ACTUAL
-- Ejecutar en Supabase > SQL Editor sobre una instalación existente.
-- Es idempotente: puede ejecutarse nuevamente sin volver a descontar precios.
-- ================================================================
begin;

create table if not exists public.app_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- Cuentas de asesores: registro propio + aprobación del administrador
-- ----------------------------------------------------------------
alter table public.profiles add column if not exists approval_status text not null default 'approved';
alter table public.profiles add column if not exists credential_type text not null default 'password';

-- Constraints compatibles con instalaciones previas.
do $$ begin
  alter table public.profiles add constraint profiles_approval_status_check
    check (approval_status in ('pending','approved','rejected'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.profiles add constraint profiles_credential_type_check
    check (credential_type in ('password','pin'));
exception when duplicate_object then null;
end $$;

-- Los perfiles que ya existían antes de esta migración permanecen aprobados.
update public.profiles
set approval_status = 'approved'
where approval_status is null or approval_status not in ('pending','approved','rejected');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, full_name, role, active, approval_status, credential_type
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'asesor',
    false,
    'pending',
    case when new.raw_user_meta_data ->> 'credential_type' = 'pin' then 'pin' else 'password' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- El usuario solo puede cambiar su propio nombre y el tipo de acceso.
create or replace function public.update_my_profile(new_name text, new_credential_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if length(trim(coalesce(new_name,''))) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  if new_credential_type not in ('password','pin') then
    raise exception 'INVALID_CREDENTIAL_TYPE';
  end if;
  update public.profiles
  set full_name = trim(new_name), credential_type = new_credential_type
  where id = auth.uid();
end;
$$;
revoke all on function public.update_my_profile(text,text) from public, anon;
grant execute on function public.update_my_profile(text,text) to authenticated;

-- ----------------------------------------------------------------
-- Acceso: una cuenta pendiente/desactivada no puede usar el CRM.
-- ----------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active = true
      and approval_status = 'approved'
  );
$$;
grant execute on function public.is_active_user() to authenticated;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
  where id = auth.uid()
    and active = true
    and approval_status = 'approved';
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

-- Rehacer políticas principales incorporando is_active_user().
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (auth.uid() = id or public.is_admin());
create policy profiles_update_admin on public.profiles
for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists vehiculos_select_auth on public.vehiculos;
drop policy if exists vehiculos_insert_admin on public.vehiculos;
drop policy if exists vehiculos_update_admin on public.vehiculos;
drop policy if exists vehiculos_delete_admin on public.vehiculos;
create policy vehiculos_select_auth on public.vehiculos for select to authenticated using (public.is_active_user());
create policy vehiculos_insert_admin on public.vehiculos for insert to authenticated with check (public.is_admin());
create policy vehiculos_update_admin on public.vehiculos for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy vehiculos_delete_admin on public.vehiculos for delete to authenticated using (public.is_admin());

drop policy if exists settings_select_auth on public.app_settings;
drop policy if exists settings_update_admin on public.app_settings;
drop policy if exists settings_insert_admin on public.app_settings;
create policy settings_select_auth on public.app_settings for select to authenticated using (public.is_active_user());
create policy settings_update_admin on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_insert_admin on public.app_settings for insert to authenticated with check (public.is_admin());

drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy clientes_insert on public.clientes for insert to authenticated
with check (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy clientes_update on public.clientes for update to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()))
with check (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy clientes_delete on public.clientes for delete to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));

drop policy if exists visitas_select on public.cliente_visitas;
drop policy if exists visitas_insert on public.cliente_visitas;
drop policy if exists visitas_update on public.cliente_visitas;
drop policy if exists visitas_delete on public.cliente_visitas;
create policy visitas_select on public.cliente_visitas for select to authenticated
using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));
create policy visitas_insert on public.cliente_visitas for insert to authenticated
with check (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));
create policy visitas_update on public.cliente_visitas for update to authenticated
using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())))
with check (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));
create policy visitas_delete on public.cliente_visitas for delete to authenticated
using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));

drop policy if exists permutas_select on public.cliente_permutas;
drop policy if exists permutas_insert on public.cliente_permutas;
drop policy if exists permutas_update on public.cliente_permutas;
drop policy if exists permutas_delete on public.cliente_permutas;
create policy permutas_select on public.cliente_permutas for select to authenticated
using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));
create policy permutas_insert on public.cliente_permutas for insert to authenticated
with check (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));
create policy permutas_update on public.cliente_permutas for update to authenticated
using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())))
with check (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));
create policy permutas_delete on public.cliente_permutas for delete to authenticated
using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())));

drop policy if exists seguimientos_select on public.seguimientos;
drop policy if exists seguimientos_insert on public.seguimientos;
drop policy if exists seguimientos_update on public.seguimientos;
drop policy if exists seguimientos_delete on public.seguimientos;
create policy seguimientos_select on public.seguimientos for select to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy seguimientos_insert on public.seguimientos for insert to authenticated
with check (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy seguimientos_update on public.seguimientos for update to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()))
with check (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy seguimientos_delete on public.seguimientos for delete to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));

drop policy if exists cotizaciones_select on public.cotizaciones;
drop policy if exists cotizaciones_insert on public.cotizaciones;
drop policy if exists cotizaciones_update on public.cotizaciones;
drop policy if exists cotizaciones_delete on public.cotizaciones;
create policy cotizaciones_select on public.cotizaciones for select to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy cotizaciones_insert on public.cotizaciones for insert to authenticated
with check (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy cotizaciones_update on public.cotizaciones for update to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()))
with check (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));
create policy cotizaciones_delete on public.cotizaciones for delete to authenticated
using (public.is_active_user() and (public.is_admin() or asesor_id = auth.uid()));

-- Historial de asignaciones.
drop policy if exists cliente_asignaciones_select on public.cliente_asignaciones;
create policy cliente_asignaciones_select on public.cliente_asignaciones
for select to authenticated
using (
  public.is_active_user()
  and (
    public.is_admin()
    or exists (select 1 from public.clientes c where c.id=cliente_id and c.asesor_id=auth.uid())
  )
);

-- ----------------------------------------------------------------
-- Precios: la tabla vehiculos guarda desde ahora PRECIO DE CONTADO.
-- El cotizador suma USD 1.000 únicamente al elegir una modalidad de crédito.
-- ----------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from public.app_migrations where migration_key = '2026-10-02-cash-price-base'
  ) then
    update public.vehiculos
    set precio = greatest(precio - 1000, 0),
        precio_bs_manual = null,
        precio_bs_modo = 'tipo_cambio';

    insert into public.app_migrations(migration_key)
    values ('2026-10-02-cash-price-base');
  end if;
end $$;

-- Origen y modo predeterminados para nuevos clientes.
update public.clientes set origen='Concesionaria' where origen='Visita por concesionaria';
alter table public.clientes alter column origen set default 'Concesionaria';
update public.clientes set modo_compra='contado' where modo_compra is null;
alter table public.clientes alter column modo_compra set default 'contado';

-- La tasa predeterminada ya no es un parámetro administrativo.
alter table public.app_settings drop column if exists tasa_interes_default;

-- Realtime de perfiles para que aprobaciones/desactivaciones se reflejen sin F5.
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;


-- Varias permutas por cliente (compatibilidad si SETUP se aplica sobre una base existente).
alter table public.cliente_permutas
  drop constraint if exists cliente_permutas_cliente_id_key;
create index if not exists idx_permutas_cliente
  on public.cliente_permutas (cliente_id, created_at);

do $$ begin
  alter publication supabase_realtime add table public.cliente_permutas;
exception when duplicate_object then null;
end $$;

commit;
