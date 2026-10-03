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
- Registro propio de asesores con nombre, Gmail y contraseña o PIN de 4 dígitos.
- Aprobación/rechazo desde Administración → Equipo de asesores.
- Sección Cuenta para editar nombre, contraseña/PIN y acceso rápido.
- Acceso rápido mediante passkeys cuando el navegador/dispositivo lo permita.
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
