-- ================================================================
-- AUTOSALE MOTORS · VEHÍCULOS COMPARTIDOS
-- Ejecutar completo en Supabase > SQL Editor
-- ================================================================

create table if not exists public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  precio numeric(14,2) not null check (precio >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.vehiculos enable row level security;

-- Todos los asesores que usan esta calculadora pueden leer y modificar
-- el catálogo compartido. Si después agregas inicio de sesión, estas
-- políticas pueden endurecerse para limitar la administración.
drop policy if exists "vehiculos_select_public" on public.vehiculos;
drop policy if exists "vehiculos_insert_public" on public.vehiculos;
drop policy if exists "vehiculos_update_public" on public.vehiculos;
drop policy if exists "vehiculos_delete_public" on public.vehiculos;

create policy "vehiculos_select_public"
on public.vehiculos for select
using (true);

create policy "vehiculos_insert_public"
on public.vehiculos for insert
with check (true);

create policy "vehiculos_update_public"
on public.vehiculos for update
using (true)
with check (true);

create policy "vehiculos_delete_public"
on public.vehiculos for delete
using (true);

-- Índice para ordenar rápidamente el catálogo.
create index if not exists idx_vehiculos_nombre
on public.vehiculos (lower(nombre));

create unique index if not exists uq_vehiculos_nombre_lower
on public.vehiculos (lower(nombre));

-- Opcional: si necesitas migrar vehículos antiguos de localStorage,
-- la aplicación puede hacerlo automáticamente cuando la tabla esté vacía.
