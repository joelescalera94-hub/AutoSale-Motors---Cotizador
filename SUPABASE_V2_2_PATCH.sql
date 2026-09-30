-- ================================================================
-- AUTOSALE MOTORS · PATCH V2.2
-- Ejecutar UNA vez en Supabase > SQL Editor después de V2.
-- No elimina clientes, cotizaciones, vehículos ni seguimientos.
-- ================================================================

-- Nuevos modos de compra usados por el CRM simplificado.
alter type public.purchase_mode add value if not exists 'garante_personal';
alter type public.purchase_mode add value if not exists 'hipotecario_vehicular';
alter type public.purchase_mode add value if not exists 'hipotecado_inmueble';

-- El estado predeterminado de nuevos clientes pasa a En seguimiento.
alter table public.clientes alter column estado set default 'en_seguimiento';

-- Normalizar datos antiguos que ya no aparecen en la interfaz.
update public.clientes
set estado = 'en_seguimiento'
where estado::text in ('nuevo','contactado','negociando','esperando_permuta','pausado');

-- La antigua opción genérica "Crédito" ya no se usa. Se deja sin definir
-- para no asumir qué tipo de financiamiento corresponde a cada cliente.
update public.clientes
set modo_compra = null
where modo_compra::text = 'credito';

-- "En revisión" ya no se usa; vuelve a pendiente para que sea revisado.
update public.cliente_permutas
set estado_revision = 'pendiente'
where estado_revision::text = 'en_revision';
