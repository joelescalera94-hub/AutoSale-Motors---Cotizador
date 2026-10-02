# AutoSale Motors · V2.5

## Cotizador
- Comparación de varios vehículos mediante pestañas/chips.
- Botón Agregar desde el buscador.
- Cada vehículo conserva sus propios valores.
- Al agregar otro vehículo se reutilizan inicial, tasa y plazo como punto de partida.
- Guardar guarda todos los vehículos para el cliente seleccionado.
- La misma combinación cliente + vehículo actualiza la cotización existente.
- Nueva cotización limpia por completo la operación anterior.
- Precio, inicial y monto pueden editarse en USD o Bs.
- Inicial y monto funcionan incluso sin precio del vehículo.
- Los ceros de inputs son placeholders.
- Presets de tasa/plazo reflejan el valor activo.
- El tipo de cambio se consulta en el cotizador y se modifica centralmente solo desde Administración.

## Cálculo financiero
- Desgravamen: 0,083 % mensual sobre saldo, configurable solo por admin y oculto en el cotizador.
- Seguro vehicular: Bs 700/mes por defecto, configurable; visible separado solo en Garantía vehicular.
- Seguro inmueble: Bs 150/mes por defecto, configurable; se suma internamente y no se muestra separado.
- El desgravamen ya no se suma a la tasa anual de interés.

## Clientes y seguimientos
- Admin y asesor trabajan en su propia cartera personal.
- El admin supervisa otras carteras únicamente desde Administración.
- Clientes y seguimientos unidos, con paginación, filtros y vistas compactas.
- Detección global de celular duplicado sin exponer la cartera de otro asesor.
- Seguimiento principal muestra solo el vigente más reciente por cliente; el resto queda en historial.
- Seguimientos y cotizaciones editables y eliminables definitivamente.
- Clientes eliminables definitivamente.
- Permuta oculta hasta activar el switch.
- Origen por defecto: Visita por concesionaria.
- Visita inicial se registra automáticamente el día de alta.
- Sin CI, WhatsApp duplicado, presupuesto, documentos ni prueba de manejo.

## Administración
- Monitoreo por asesor: clientes, estados, pendientes, vencidos, cotizaciones y clientes sin movimiento.
- Vista completa de la cartera de cada asesor, sus cotizaciones y seguimientos.
- Reasignación masiva e historial de asignación.
- Crear, desactivar, restablecer contraseña, revocar passkeys y eliminar asesores.
- No permite eliminar un asesor mientras tenga clientes asignados.
- Se eliminó Actividad reciente y Papelera/Recuperación de la interfaz.

## Acceso
- Contraseña temporal obligatoria en primer ingreso.
- Acceso rápido opcional con passkey: huella, Face ID, Windows Hello o PIN seguro del dispositivo.
- Mensajes reales de la Edge Function en lugar del antiguo aviso genérico de “falta desplegar”.

## Diseño
- Buscador superior visible solo en Cotizador.
- Modal de cliente con scroll y acciones inferiores corregidas.
- Fechas/horas y calendarios con estilo uniforme.
- Mejoras responsive para muchos clientes, seguimientos y acciones de asesores.
