# AutoSale Motors V2.4 · despliegue

## 1. Base de datos

En Supabase > **SQL Editor**, abre `SUPABASE_V2_4_PATCH.sql`, pega todo su contenido y pulsa **Run**.
Debe terminar sin error.

## 2. Edge Function para crear asesores

La función segura está en:

`supabase/functions/admin-create-user/index.ts`

### Opción A · Supabase CLI

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy admin-create-user
```

La función usa automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` dentro del entorno de Supabase. **No copies la service role al navegador ni a GitHub Pages.**

### Opción B · Dashboard

Crea una Edge Function llamada `admin-create-user`, pega el contenido de `index.ts` y despliega la función con verificación JWT habilitada.

Después, en AutoSale, ve a **Administración > Asesores > + Invitar asesor**. El administrador define nombre, correo y una contraseña temporal.

## 3. Publicación

Reemplaza los archivos del repositorio del cotizador por los de esta versión y publica GitHub Pages.

## 4. Prueba recomendada

1. Inicia sesión como admin.
2. Crea un asesor.
3. Crea un cliente y una permuta.
4. Crea y edita un seguimiento.
5. Crea, edita y elimina/restaura una cotización.
6. Comprueba el dashboard de actividad.
