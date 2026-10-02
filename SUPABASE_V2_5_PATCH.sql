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
