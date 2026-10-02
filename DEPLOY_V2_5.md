# AutoSale Motors · despliegue V2.5

Esta versión parte del ZIP que estaba actualmente en GitHub y agrega el cotizador multi-vehículo, seguridad de asesores, nueva lógica financiera y mejoras del CRM.

## Orden recomendado

### 1. Ejecutar el parche de base de datos

En Supabase → **SQL Editor → New query**, pega y ejecuta completo:

`SUPABASE_V2_5_PATCH.sql`

Debe terminar con `Success. No rows returned`.

El parche:
- conserva clientes y vehículos activos;
- fija el desgravamen inicial en **0,083 % mensual sobre saldo**;
- añade seguro vehicular **Bs 700/mes** y seguro de inmueble **Bs 150/mes** como valores editables por el admin;
- prepara contraseña temporal obligatoria;
- añade los campos de cotización V2.5;
- evita nuevos clientes duplicados por celular a nivel de base;
- deja una sola cotización activa por **cliente + vehículo** (si ya había duplicados, conserva la más reciente);
- hace que al eliminar un cliente también se eliminen sus cotizaciones.

### 2. Reemplazar los archivos del repositorio del cotizador

Sube los archivos de este paquete a:

`AutoSale-Motors---Cotizador`

El `supabase-config.js` incluido conserva el proyecto de Supabase actual.

### 3. Volver a desplegar la Edge Function

GitHub Pages **no despliega** Edge Functions automáticamente.

En Supabase → **Edge Functions**, abre la función cuyo slug es exactamente:

`admin-create-user`

Reemplaza su `index.ts` por:

`supabase/functions/admin-create-user/index.ts`

Y pulsa **Deploy function**.

La función V2.5 permite:
- crear asesores;
- restablecer contraseña temporal;
- eliminar asesores cuando ya no tienen clientes asignados;
- revocar accesos rápidos/passkeys;
- finalizar el cambio obligatorio de contraseña.

### 4. Activar huella / PIN del dispositivo (opcional pero recomendado)

La app sigue funcionando con correo + contraseña aunque no actives esta función.

Para habilitar acceso con huella, Face ID, Windows Hello o PIN del dispositivo:

Supabase → **Authentication → Passkeys**

- Enable Passkey authentication: **ON**
- Relying Party Display Name: `AutoSale Motors`
- Relying Party ID: `joelescalera94-hub.github.io`
- Relying Party Origins: `https://joelescalera94-hub.github.io`

Importante: las passkeys quedan ligadas al dominio. Si después AutoSale usa un dominio propio, habrá que cambiar esta configuración y registrar nuevas passkeys.

### 5. Prueba mínima antes de usarlo con el equipo

1. Entrar como administrador.
2. Crear un asesor de prueba.
3. Entrar con la contraseña temporal y comprobar que obliga a cambiarla.
4. Activar huella/PIN en ese dispositivo (si habilitaste Passkeys).
5. Crear un cliente con el admin y otro con el asesor: cada uno debe ver solo su cartera en Clientes/Cotizador.
6. Desde Administración → Equipo, el admin debe poder ver ambas carteras.
7. Agregar dos vehículos a una misma cotización, guardar y comprobar que se guardan ambos para el mismo cliente.
8. Volver a guardar uno de esos vehículos: debe actualizar la cotización existente, no duplicarla.
9. Probar Garantía vehicular: debe mostrar Bs 700 de seguro separado y el total.
10. Probar Garantía de inmueble: el seguro Bs 150 y desgravamen se incorporan internamente, sin mostrarse como líneas separadas.

## Nota de seguridad

No pongas `SUPABASE_SERVICE_ROLE_KEY` en GitHub, `supabase-config.js` ni JavaScript del navegador. La Edge Function usa las variables seguras que Supabase proporciona en su entorno.
