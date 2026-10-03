# AutoSale Motors · V2.6

## Cotizador
- Compartir abre WhatsApp y envía todas las cotizaciones/vehículos agregados en un solo mensaje.
- Nueva cotización inicia en **Contado**.
- Al agregar un vehículo en contado, su precio sugerido es el precio interno menos **USD 1.000**.
- Al cambiar entre Contado y una modalidad financiada, el precio del vehículo vuelve automáticamente al precio interno o aplica el descuento de contado.
- Se mantiene la edición manual del precio de la cotización.
- La tasa inicial del cotizador sigue siendo 16%, pero se eliminó la opción de “tasa predeterminada” de Administración.
- El desgravamen y seguro de inmueble siguen ocultos en la cotización; el seguro vehicular se muestra solamente en Garantía vehicular.

## Clientes y seguimiento
- Seguimientos se muestran antes que la cartera de clientes.
- Clientes y seguimientos muestran 10 registros por página.
- Se mantienen búsqueda y filtros.

## Administración / asesores
- El botón “Ficha” se renombró a **Ver cliente**.
- La cartera de cada asesor tiene buscador y paginación.
- El administrador sigue viendo la cartera completa de los asesores desde Administración, sin mezclarla con su cartera personal.

## Vehículos
- Administración de vehículos dividida en dos áreas: Agregar/editar e Inventario.
- Inventario con buscador y paginación.
- Se muestran únicamente precios en USD.
- Se eliminaron de este formulario los controles de precio Bs manual/modo Bs; la conversión usa el tipo de cambio central.
- Botones y texto corregidos para tema oscuro y pantallas pequeñas.

## Catálogo web
- Se agregó paginación al listado de fichas del catálogo.

## Diseño
- Transiciones suaves al cambiar de vistas y abrir modales.
- Mejor respuesta en escritorio, tablet y móvil.
- Controles de fecha/hora con un tratamiento visual tipo tarjeta/bento, manteniendo inputs nativos para compatibilidad.
- Respeta `prefers-reduced-motion`.
