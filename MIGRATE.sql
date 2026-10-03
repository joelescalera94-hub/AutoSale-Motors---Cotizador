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

commit;
