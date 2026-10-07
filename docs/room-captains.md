# Capitanes de dormitorio desde Administración

Ejecuta `supabase/29_room_server_captains.sql` completo en el SQL Editor del
proyecto Supabase, después de las migraciones 17–28. La migración es transaccional,
se puede repetir y recarga la caché de PostgREST. Después recarga la aplicación.

Ejecuta también `supabase/30_dashboard_captain_occupancy.sql` para que el indicador
de ocupación de Inicio incluya la cama asignada al capitán, igual que Alojamientos.
Un dormitorio de ocho camas con solo el capitán asignado muestra una ocupada y
siete libres. La migración conserva los demás indicadores y no cambia asignaciones.

Al crear o editar un dormitorio, el selector incluye cepevistas, colportores y
usuarios con rol **servidor** creados en Administración. El administrador selecciona
el usuario y escribe su WhatsApp; no necesita registrarlo antes como cepevista.

La primera asignación crea una identidad interna de alojamiento vinculada al
usuario. Usa la sección del dormitorio, señalada expresamente en el formulario,
y deja desconocida la fecha de nacimiento. Las fichas normales siguen requiriendo
fecha de nacimiento. Las asignaciones posteriores respetan la sección registrada.
No se crea una cuenta de pagos ni se cambia el rol o los permisos del usuario.

La identidad se reutiliza al editar y cambiar capitanes. La cama del capitán queda
reservada, se libera su estadía anterior y se puede conservar al capitán saliente
en otra cama con las reglas existentes. Un servidor no puede ser capitán de dos
dormitorios. Cambiar su nombre en Administración actualiza el nombre mostrado.

Si cambia su rol, se conserva la capitanía actual y puede editarse ese dormitorio;
no puede recibir una nueva capitanía como servidor. No se elimina una cuenta
vinculada a una identidad de alojamiento, para conservar la referencia e historial.
Las fichas existentes y las cuentas no se vinculan automáticamente por nombre.

Pruebas locales con PostgreSQL embebido, sin conexión a Supabase:

```powershell
npm.cmd install --prefix .room-tests.local --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
node tests/room_captains.mjs .room-tests.local/node_modules/@electric-sql/pglite/dist/index.js
```
