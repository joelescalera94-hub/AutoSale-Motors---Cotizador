# AutoSale Motors · Puesta en marcha V2

## 1. Supabase

En **Supabase > SQL Editor** ejecuta completo:

`SUPABASE_V2_SETUP.sql`

No ejecutes el `SUPABASE_SETUP.sql` anterior: quedó deprecado porque permitía
modificar vehículos sin autenticación.

## 2. Crear el administrador

En **Authentication > Users**, crea el primer usuario.

Luego copia su UUID y ejecuta:

```sql
update public.profiles
set role = 'admin', active = true, full_name = 'Administrador'
where id = 'UUID_DEL_USUARIO_ADMIN';
```

Los usuarios nuevos quedan como `asesor` por defecto.

## 3. Invitar asesores desde el panel

Se incluye:

`supabase/functions/admin-create-user/index.ts`

Despliega la Edge Function con Supabase CLI.

Configura el secreto `SUPABASE_SERVICE_ROLE_KEY` solamente en Supabase.
**Nunca lo pongas dentro del repositorio ni en JavaScript del navegador.**

También puedes definir `AUTOSALE_APP_URL` con la URL de GitHub Pages del
cotizador para que el enlace de invitación vuelva a la aplicación.

## 4. Catálogo web

El panel de administrador permite crear una ficha pública y subir imagen
principal/galería al bucket `catalogo` de Supabase Storage.

La web pública consulta:

`public.catalogo_publico`

La vista solo expone información comercial pública y **no contiene precio USD,
precio Bs, tipo de cambio, datos de clientes ni datos de asesores**.

## 5. Publicación

### Cotizador

Reemplaza los archivos del repositorio:

`AutoSale-Motors---Cotizador`

por los de esta versión y deja GitHub Pages apuntando a la rama publicada.

### Web comercial

Reemplaza los archivos del repositorio:

`AutoSale-Motors-`

por los de esta versión.

La web mantiene un inventario estático de respaldo y utiliza Supabase para
sobrescribir/añadir las fichas que el administrador haya publicado.

## 6. Nota importante sobre el catálogo existente

No es obligatorio importar todo el inventario estático a Supabase antes de
publicar. La web mantiene el catálogo existente como respaldo.

Cuando quieras que un vehículo quede totalmente administrado desde el panel,
créalo o edítalo en **Catálogo web** y publícalo desde allí.
