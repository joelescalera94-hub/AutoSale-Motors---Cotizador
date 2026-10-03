# AutoSale Motors · CRM y Cotizador

Sistema interno para cotización, clientes, seguimientos, asesores, inventario y administración del catálogo web.

## Estructura

- `index.html` — interfaz principal.
- `styles.css` — diseño dark navy, responsive y accesibilidad.
- `app.js` — lógica del cotizador, CRM, cuentas y administración.
- `supabase-config.js` — URL y anon key del proyecto Supabase.
- `manifest.json` / `sw.js` — instalación PWA y actualización de caché.
- `database/SETUP.sql` — instalación completa para una base nueva.
- `database/MIGRATE.sql` — actualización para la base existente.
- `supabase/functions/admin-user/index.ts` — acciones administrativas seguras.
- `DEPLOY.md` — pasos de publicación.
- `TESTING.md` — pruebas antes de usar en producción.
- `CHANGELOG.md` — historial de esta consolidación.

## Flujo de asesores

1. El asesor pulsa **Crear cuenta**.
2. Ingresa nombre, Gmail y una contraseña de al menos 8 caracteres.
3. La cuenta queda **Pendiente** y no puede usar el CRM.
4. El administrador entra a **Administración → Equipo de asesores** y la aprueba o rechaza.
5. Una vez aprobada, el asesor puede entrar y administrar únicamente su cartera.
6. Desde **Cuenta** puede cambiar su nombre y contraseña.

## Regla de precios

`vehiculos.precio` representa el **precio de contado en USD**. El cotizador usa ese valor sin cambios para Contado y agrega **USD 1.000** al seleccionar una modalidad de crédito.

La migración actual convierte una sola vez los precios antiguos al precio de contado restando USD 1.000. La tabla `app_migrations` impide que el descuento vuelva a aplicarse si el SQL se ejecuta otra vez.

## Nota de arquitectura

Este proyecto sigue siendo HTML + CSS + JavaScript sin framework. No se mezclaron componentes React/shadcn dentro de producción porque requeriría una migración completa del proyecto. El diseño solicitado se trasladó al sistema actual sin cambiar su arquitectura.
