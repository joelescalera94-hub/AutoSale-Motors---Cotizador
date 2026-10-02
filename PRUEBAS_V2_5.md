# AutoSale Motors · Pruebas V2.5

Haz estas pruebas después de ejecutar el parche SQL y desplegar la Edge Function V2.5.

## Acceso y asesores
1. Entra como administrador.
2. Crea un asesor con contraseña temporal.
3. Entra con la cuenta nueva: debe obligar a cambiar la contraseña.
4. Si Passkeys está habilitado, registra huella/PIN y prueba cerrar/abrir sesión.
5. Desde admin prueba: desactivar, reactivar, restablecer contraseña y revocar huella/PIN.
6. Para eliminar un asesor, primero reasigna sus clientes; con clientes asignados debe bloquearse el borrado.

## Cartera personal vs administración
1. Crea un cliente con el administrador.
2. Crea otro cliente desde la cuenta de asesor.
3. En Clientes y seguimiento del admin debe aparecer solo el cliente del admin.
4. En Clientes y seguimiento del asesor debe aparecer solo el cliente del asesor.
5. En Administración → Equipo, el admin debe poder abrir la cartera del asesor y ver sus clientes, cotizaciones, seguimientos y permutas.

## Cotizador multi-vehículo
1. Selecciona un cliente.
2. Busca un vehículo y pulsa Agregar.
3. Define una inicial, tasa y plazo.
4. Agrega un segundo vehículo: debe conservar esos valores como punto de partida.
5. Cambia entre pestañas y verifica que cada vehículo conserve luego sus propios cambios.
6. Guarda: deben guardarse todas las cotizaciones.
7. Modifica un vehículo ya cotizado y guarda de nuevo: debe actualizar la cotización cliente + vehículo, no duplicarla.
8. Pulsa Nueva cotización: debe quedar todo limpio.

## Cálculo financiero
- Garante personal: desgravamen incluido internamente; no debe aparecer como línea.
- Garantía vehicular: desgravamen oculto + seguro vehicular visible (Bs 700 por defecto) + total mensual.
- Garantía de inmueble: desgravamen y seguro inmueble (Bs 150 por defecto) incluidos internamente; no deben mostrarse como líneas.
- Contado: sin tasa, plazo ni seguros de financiamiento.
- Cambia los valores desde Administración y comprueba que se actualicen centralmente.

## Clientes y seguimientos
1. Nuevo cliente: origen por defecto Visita por concesionaria.
2. La visita inicial debe registrarse el mismo día.
3. Permuta debe permanecer oculta hasta activar el switch.
4. Desactivar el switch debe limpiar la permuta.
5. Intenta repetir un celular: debe bloquearse.
6. Crea, edita y elimina una cotización.
7. Crea, edita y elimina un seguimiento.
8. La vista principal debe mostrar solo el seguimiento vigente del cliente; el historial conserva los anteriores completados.
9. Elimina un cliente y confirma que desaparecen sus datos relacionados.

## Interfaz
- El buscador superior solo debe mostrarse en Cotizador.
- El modal de cliente debe poder desplazarse y los botones inferiores no deben quedar cortados.
- Fechas y horas deben ser editables tanto en PC como en celular.
- Con muchos clientes/seguimientos, filtros y paginación deben seguir funcionando.
