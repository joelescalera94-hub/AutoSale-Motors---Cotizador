# Pruebas antes de publicar

Marca cada prueba después de desplegar `database/MIGRATE.sql`, la Edge Function `admin-user` y los archivos web.

## Inicio y cuenta

- [ ] Abrir AutoSale muestra el logo mientras verifica sesión.
- [ ] Con sesión válida entra directamente al sistema.
- [ ] Sin sesión muestra Iniciar sesión / Crear cuenta.
- [ ] Crear cuenta con Gmail + contraseña deja la cuenta pendiente.
- [ ] Una cuenta pendiente no puede entrar al CRM.
- [ ] Admin puede aprobar o rechazar desde Equipo de asesores.
- [ ] Un asesor aprobado puede entrar.
- [ ] Cuenta permite cambiar nombre y contraseña.

## Vehículos y precios

- [ ] Los precios del inventario son USD 1.000 menores que los antiguos precios de crédito.
- [ ] Ejecutar `MIGRATE.sql` una segunda vez NO vuelve a descontar USD 1.000.
- [ ] El buscador de vehículo muestra precio de contado.
- [ ] Cotización nueva inicia en Contado.
- [ ] Contado usa exactamente el precio guardado del vehículo.
- [ ] Garante personal suma USD 1.000.
- [ ] Garantía vehicular suma USD 1.000.
- [ ] Garantía de inmueble suma USD 1.000.
- [ ] Volver a Contado resta nuevamente ese recargo de crédito.
- [ ] Editar → Guardar vehículo funciona repetidamente sin recargar la página.
- [ ] Agregar y eliminar vehículos actualiza la lista inmediatamente.

## Cotizaciones

- [ ] Agregar 2–3 vehículos crea pestañas independientes.
- [ ] Guardar varias cotizaciones para un cliente funciona sin duplicar cliente + vehículo innecesariamente.
- [ ] Compartir abre WhatsApp con todas las cotizaciones activas en un solo mensaje.
- [ ] Guardar muestra estado de Guardando y vuelve a habilitar el botón aunque exista un error.

## Clientes y seguimientos

- [ ] Origen nuevo aparece como Concesionaria.
- [ ] Modo nuevo aparece como Contado.
- [ ] Tarjeta de cliente muestra + Cotizar, + Seguimiento, Historial, Exportar PDF y Editar.
- [ ] Historial contiene cotizaciones y seguimientos del cliente.
- [ ] PDF contiene únicamente datos, cotizaciones y seguimientos de ese cliente.
- [ ] Seguimiento vigente muestra solo Editar, Completar y Eliminar.
- [ ] Guardar/editar seguimiento funciona varias veces sin F5.
- [ ] Eliminar cliente usa modal propio y elimina sus datos relacionados según la base.

## Paginación y responsive

- [ ] Más de 10 clientes genera paginación.
- [ ] Más de 10 seguimientos genera paginación.
- [ ] Vehículos, asesores, carteras e historial no forman listas interminables.
- [ ] Los buscadores y filtros funcionan aunque el resultado esté en otra página.
- [ ] Revisar a 360 px, 390 px, 768 px, 1366 px y 1920 px de ancho.
- [ ] Modales quedan centrados y utilizables con scroll cuando el contenido es largo.
- [ ] Navegación por teclado muestra foco visible.

## Estabilidad

- [ ] Hacer 10 ciclos seguidos de editar/guardar vehículo sin recargar.
- [ ] Hacer 10 ciclos seguidos de editar/guardar cliente sin recargar.
- [ ] Hacer 10 ciclos seguidos de editar/guardar seguimiento sin recargar.
- [ ] Después de publicar un cambio, cerrar y volver a abrir muestra la versión nueva sin limpiar caché manualmente.
- [ ] Revisar la consola del navegador: no deben quedar errores rojos durante los flujos anteriores.


## Clientes, varias permutas y sincronización

1. Crea un cliente y guárdalo.
2. Edítale el nombre dos veces seguidas sin recargar la página. El cambio debe reflejarse inmediatamente.
3. Activa “¿Tiene permuta?”, completa una permuta y usa “+ Agregar otra permuta”.
4. Guarda, vuelve a editar el cliente y verifica que ambas permutas sigan registradas.
5. Elimina solo una permuta, guarda y confirma que la otra permanezca.
6. Guarda dos o más cotizaciones distintas para el mismo cliente. La tarjeta debe mostrar esos vehículos como intereses derivados.
7. Exporta el PDF y verifica que contenga datos del cliente, todas sus cotizaciones, permutas, seguimientos y visitas.

