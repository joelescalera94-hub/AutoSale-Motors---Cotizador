# Corrección CRM · 2026-10-03

- Eliminado “Vehículo de interés” del formulario de cliente.
- Los vehículos de interés se derivan automáticamente de las cotizaciones guardadas.
- Un cliente puede registrar varias permutas y agregar/eliminar cada una desde el mismo formulario.
- PDF de cliente ampliado con datos generales, resumen, todas las cotizaciones, permutas, seguimientos y visitas.
- Guardado de cliente con actualización optimista y recarga controlada desde Supabase para evitar depender de F5.
- Realtime agregado para cambios de permutas.
- `database/MIGRATE.sql` elimina la restricción de una sola permuta por cliente.
- Edge Function `admin-user` incluida y simplificada a flujo de contraseña, sin passkeys.

# Corrección de acceso · 2026-10-03

- Inicio de sesión simplificado a Gmail + contraseña.
- Eliminados PIN y acceso con huella/passkeys de la interfaz.
- Corregido el atributo `pattern` que podía impedir iniciar sesión con una contraseña válida.
- Registro nuevo con contraseña y confirmación de contraseña.
- Cuenta permite cambiar nombre y contraseña.
- Caché/PWA actualizado para evitar que GitHub Pages conserve el login anterior.

# Historial de cambios

## Consolidación · 2026-10-02

- Nuevo diseño dark navy, responsive y con mejoras de foco, contraste y áreas táctiles.
- Splash inicial con logo mientras se verifica la sesión existente.
- Aprobación/rechazo desde Administración → Equipo de asesores.
- Cartera personal del administrador separada de la supervisión del equipo.
- Seguimientos antes de Clientes y tarjetas de seguimiento simplificadas a Editar, Completar y Eliminar.
- Estado de seguimiento renombrado a Estado del cliente.
- Cliente con acciones + Cotizar, + Seguimiento, Historial, Exportar PDF y Editar.
- Historial unificado con todas las cotizaciones y seguimientos del cliente.
- PDF individual por cliente con sus datos, cotizaciones y seguimientos.
- Origen predeterminado: Concesionaria.
- Modo de compra predeterminado: Contado.
- Inventario guarda y muestra precio de contado en USD.
- Modalidades de crédito agregan USD 1.000 al precio de contado.
- Compartir por WhatsApp incluye todas las cotizaciones activas del cotizador.
- Paginación en clientes, seguimientos, vehículos, asesores, carteras e historiales.
- Buscador y administración de vehículos mejorados.
- Eliminadas confirmaciones nativas del navegador en acciones críticas; se usan modales propios.
- Guardados con estados de carga/error y refresco inmediato para reducir operaciones que parecían no responder.
- Service Worker renovado para evitar caché obsoleta después de publicar.
- Archivos de cambios, deploy, pruebas y SQL antiguos consolidados en nombres estables.
