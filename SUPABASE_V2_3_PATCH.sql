-- ================================================================
-- AUTOSALE MOTORS · PATCH V2.3
-- Ejecutar UNA vez en Supabase > SQL Editor después de V2.2.
-- No elimina clientes, vehículos, cotizaciones ni seguimientos.
-- ================================================================

-- Nuevas fichas web se publican normalmente por defecto.
alter table public.vehiculos alter column public_published set default true;

-- Bandera de oferta independiente de destacado/novedad.
alter table public.vehiculos
  add column if not exists public_offer boolean not null default false;

-- Ya no se usa la etiqueta Novedad desde el panel.
update public.vehiculos set public_new = false where public_new = true;

-- Nuevo cliente: origen predeterminado.
alter table public.clientes
  alter column origen set default 'Visita por concesionaria';

-- Vista pública sin precios ni datos internos.
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

grant select on public.catalogo_publico to anon, authenticated;
