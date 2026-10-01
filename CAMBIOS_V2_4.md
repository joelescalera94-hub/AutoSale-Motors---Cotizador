# AutoSale Motors · V2.4

Cambios incluidos en esta revisión:

- Nueva cotización limpia vehículo, cliente y valores anteriores.
- Precio, inicial y monto usan `0` como placeholder, no como valor escrito.
- Cuota inicial y monto financiado se pueden editar aunque no exista precio de vehículo.
- USD/Bs se sincronizan y ambos pueden editarse.
- La inicial/monto manual se conserva al cambiar de vehículo; un porcentaje elegido sí se recalcula por porcentaje.
- Botones de tasa/plazo/porcentaje reflejan el valor activo desde el inicio.
- Borrador automático de cotización y de nuevo cliente.
- Cotizaciones: crear, editar y eliminar (borrado recuperable).
- Seguimientos: crear, editar, completar y eliminar (borrado recuperable).
- Seguimientos vigentes: uno por cliente, agrupados en Vencidos/Hoy/Mañana/Esta semana/Más adelante.
- Próximos pasos limitados a: visita, crédito, carpeta, cuota inicial, mensaje/llamada y permuta.
- Fecha y hora de seguimiento separadas y con mejor presentación.
- Permuta oculta hasta activar el switch; al desactivarla se limpian sus campos.
- Origen y motivo de pérdida permiten escribir un valor personalizado directamente en el mismo campo.
- Clientes: filtros por estado, modo de compra, permuta, asesor e inactividad; paginación para carteras grandes.
- Acciones rápidas por cliente: Cotizar, Seguimiento, Editar y Cotizaciones.
- Última actividad y próximo seguimiento visibles en la tarjeta del cliente.
- Detección de celular duplicado antes de guardar.
- Archivo de clientes y papelera recuperable para admin.
- Reasignación masiva e historial de reasignación.
- Exportación CSV de clientes y cotizaciones.
- Búsqueda global por cliente, celular, vehículo o cotización.
- Dashboard de actividad del equipo con seguimientos vencidos, cotizaciones de 7 días y clientes sin movimiento.
- Actividad reciente basada en auditoría.
- Al marcar un cliente como vendido se cierran sus seguimientos pendientes.
- Admin puede tener y gestionar sus propios clientes igual que un asesor.
- Creación segura de asesores mediante Edge Function `admin-create-user`.
- Diseño responsive reforzado para listas grandes y uso móvil.
