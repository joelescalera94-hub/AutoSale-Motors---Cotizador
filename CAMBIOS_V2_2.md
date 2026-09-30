# AutoSale Motors · V2.2

## Cambios de interfaz y CRM
- El precio del vehículo queda en un único bloque con USD y Bs editables.
- Se eliminó WhatsApp como dato separado del cliente; se usa Celular.
- Origen: Facebook, TikTok, Recomendación de un cliente anterior, Visita por concesionaria, Web y Otro (escribible).
- Modo de compra: Contado, Garante personal, Hipotecario vehicular, Hipotecado de inmueble.
- Estados: En seguimiento, Vendido, Perdido, Esperando crédito.
- Motivo de pérdida: Precio alto, Crédito rechazado, Permuta rechazada, Dejó de responder y Otro (escribible).
- Se eliminó Presupuesto USD del formulario.
- Permuta simplificada a Marca, Modelo, Año, Placa, Motor, Combustible, Precio y Estado de revisión.
- El administrador puede asignarse clientes a sí mismo y trabajar como asesor.
- Se quitó el panel interno de resumen del modal de cliente.
- Las acciones del cliente ahora incluyen Ver/editar, Cotizaciones y Seguimientos.
- Cotizaciones abre el historial completo del cliente.
- Seguimientos abre el historial completo del cliente y permite crear uno nuevo.
- La pestaña Seguimientos ahora funciona como historial general con búsqueda y filtros.

## Base de datos
Si ya ejecutaste SUPABASE_V2_SETUP.sql anteriormente, ejecuta solamente:

`SUPABASE_V2_2_PATCH.sql`

No borra vehículos, clientes, cotizaciones ni seguimientos.
