# AutoSale Motors · Cotizador + CRM V2

Esta versión convierte el cotizador en el núcleo interno de AutoSale Motors.

## Roles

### Administrador

- Agrega y edita vehículos.
- Cambia precios USD y Bs.
- Cambia el tipo de cambio.
- Gestiona la ficha pública de cada vehículo.
- Ve todos los clientes de los asesores.
- Puede reasignar clientes.
- Ve cotizaciones y seguimientos.
- Ve actividad de los asesores.
- Ve auditoría.

### Asesor

- Usa el cotizador completo.
- Busca vehículos.
- Puede ajustar el precio de una cotización sin cambiar el precio oficial.
- Puede ajustar el precio Bs de una cotización.
- Guarda cotizaciones.
- Crea y gestiona sus clientes.
- Registra visitas.
- Registra y programa seguimientos.
- Registra y gestiona permutas.

## Datos del cliente

No se incluyen CI, documentos ni prueba de manejo.

La ficha contempla nombre, celular/WhatsApp, origen, vehículo de interés,
contado/crédito, presupuesto opcional, visitas, seguimiento, notas,
cotizaciones y permuta.

## Web comercial

El proyecto `AutoSale-Motors-` es la web pública.

La web no muestra precios y consulta solamente `catalogo_publico`, una vista
que no contiene columnas de precio ni datos internos. La relación web → CRM
no es automática: un cliente que llegue desde un enlace puede ser registrado
manualmente y asignado por el administrador al asesor que corresponda.

## Seguridad

El navegador utiliza solamente la publishable/anon key. Las acciones sensibles
se controlan con Supabase Auth + RLS. La service role key nunca debe ponerse en
GitHub Pages; se utiliza solamente dentro de la Edge Function para invitar
asesores.

## V2.1 · Correcciones de interfaz
- El login se oculta de forma forzada al iniciar sesión y la aplicación ocupa toda la pantalla.
- Precio, cuota inicial y monto financiado pueden trabajarse en USD o Bs.
- Al editar USD o Bs, la otra moneda conserva la misma proporción de inicial/financiamiento.
- El precio Bs puede seguir siendo automático por tipo de cambio o manual/comercial.
- Diseño responsive renovado para escritorio y celular.
- Se corrigió el SQL idempotente de políticas para poder volver a ejecutarlo sin el error `profiles_update_admin already exists`.
