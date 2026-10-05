# Publicar AutoSale Motors

## Si ya tienes AutoSale funcionando

1. Haz una copia de seguridad de tu base de datos o, como mínimo, de las tablas `vehiculos`, `clientes`, `cotizaciones`, `seguimientos` y `profiles`.
2. En **Supabase → SQL Editor**, ejecuta **solo** `database/MIGRATE.sql`.
   - Es idempotente.
   - La reducción de USD 1.000 en los precios actuales de vehículos se ejecuta una sola vez y queda registrada en `app_migrations`.
3. Sustituye los archivos de tu repositorio por los de este paquete.
4. Despliega la Edge Function con nombre estable `admin-user` usando `supabase/functions/admin-user/index.ts`.
5. Verifica que la función tenga acceso a `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno de Supabase.
6. Publica GitHub Pages y ejecuta `TESTING.md`.

## Si vas a crear una base nueva

Ejecuta `database/SETUP.sql` en lugar de `MIGRATE.sql`. Después configura `supabase-config.js`, despliega `admin-user` y publica la web. Para una instalación totalmente nueva, registra primero la cuenta que será administradora y promuévela una sola vez desde SQL con su UUID: `update public.profiles set role='admin', active=true, approval_status='approved' where id='UUID_DEL_ADMIN';`.

## Registro de asesores

El registro usa Supabase Auth. Si tu proyecto exige confirmación de correo, el asesor tendrá que confirmar su Gmail antes de poder iniciar sesión. La aprobación dentro de AutoSale es un control adicional e independiente: una cuenta no aprobada no obtiene acceso al CRM.

## Función anterior

La aplicación ya no usa `admin-create-user`. Después de verificar que `admin-user` funciona, puedes eliminar la función antigua desde Supabase para dejar el proyecto limpio.

## Caché

El Service Worker usa red primero para HTML, JavaScript, CSS y JSON y renueva su caché automáticamente. Esto reduce el problema de quedarse trabajando con archivos antiguos después de publicar una actualización.
