# Roles y mantenimiento del CEPEV

## Activación

Ejecuta `supabase/26_roles_maintenance.sql` completo en el SQL Editor de Supabase,
después de la migración 25. Se puede volver a ejecutar. La consulta final muestra
los roles (`admin, servidor, capitan, cepevista`), el número de usuarios, `true` en
mantenimiento y `0` en `lecturas_abiertas`.

**La migración convierte a los usuarios existentes:** `coordinador` → `admin` y
`consulta` → `cepevista`. Revisa después quién debe ser servidor o capitán
(ver `supabase/06_admin.sql`).

## Roles

| Rol | Qué ve | Qué puede hacer |
|---|---|---|
| admin | Toda la app | Opera todos los módulos, gestiona y resuelve reportes, configura áreas |
| servidor | Solo Mantenimiento | Reportar y seguir sus propios reportes |
| capitan | Solo Mantenimiento | Igual que servidor |
| cepevista | Toda la app, solo lectura | Nada; no reporta |

Los usuarios nuevos quedan como `cepevista`. Para cambiar un rol:

```sql
update public.profiles set role = 'capitan'
 where id = (select id from auth.users where email = 'capitan@ejemplo.com');
```

La restricción no es solo visual: las políticas de lectura que antes permitían a
cualquier usuario autenticado ahora usan `public.can_read()` (admin y cepevista).
Servidor y capitán no pueden leer personas, pagos, cocina ni la bitácora por la API.
**Las migraciones futuras deben usar `public.can_read()` en sus políticas de lectura**
en lugar de `using (true)`.

## Módulo de Administración (27_admin_access.sql)

Ejecuta `supabase/27_admin_access.sql` después de la 26. Solo el admin ve el módulo
**Administración** (menú lateral):

- **Accesos por perfil:** una matriz de módulos × perfiles (servidor, capitán,
  cepevista) con un check por celda. El admin ve todo y no se edita. Los cambios
  se aplican cuando el usuario vuelve a ingresar o recarga la página.
- **Usuarios:** grilla con nombre, correo, perfil, último ingreso y fecha de
  creación. El admin **crea**, **edita** (nombre, correo, perfil, contraseña) y
  **elimina** usuarios. No puede quitarse su perfil de admin ni eliminarse, y siempre
  debe quedar al menos un administrador. Al eliminar, lo que registró se conserva.

### Usuarios: solo los crea el administrador

La pantalla de ingreso ya no permite crear cuentas. Crear, editar y eliminar usa
la Edge Function `supabase/functions/admin-users`, porque requiere la llave de
servicio, que nunca va al navegador. La función verifica que quien llama sea admin.

Desplegarla una vez (y cada vez que cambie):

```sh
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase functions deploy admin-users
```

Supabase entrega automáticamente `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` a la función. Si no está desplegada, la app lo indica.

**Recomendado:** en Supabase, *Authentication → Sign In / Providers → Email*,
desactiva «Allow new users to sign up». Quitar el botón de la app no impide que
alguien se registre llamando directamente a la API; las cuentas que crea el
administrador desde la app no se ven afectadas por este ajuste.

Los checks también gobiernan la base de datos: con cualquier módulo de operación
marcado, el perfil puede **leer** la operación (`can_read()`); con Mantenimiento,
puede **reportar** (`can_report()`). Escribir sigue siendo solo del admin. La
lectura es por perfil, no por tabla: un perfil con un solo módulo de operación
puede consultar por la API los datos de los demás, aunque no los vea en el menú.

Por defecto quedan los accesos de la migración 26: servidor y capitán con
Mantenimiento; cepevista con todos los módulos de operación.

## Mantenimiento

- **Áreas:** dormitorios, cocina, comedor, baños, lavandería, capilla, salones,
  oficinas, zonas verdes, parqueadero, portería, red eléctrica, agua y otra área.
  La administración agrega o desactiva áreas.
- **Reporte:** área (y cuarto si es un dormitorio), lugar exacto, tipo (daño,
  reparación, mantenimiento o limpieza), prioridad (normal o urgente), descripción
  y una foto opcional (JPG, PNG o WEBP de hasta 5 MB).
- **Estados:** Abierto → En proceso (con responsable) → Resuelto (con lo que se hizo
  y costo opcional). Se puede reabrir.
- **Fotos:** bucket privado `maintenance-photos`. Cada usuario sube a su carpeta;
  la operación ve todas las fotos y quien reporta, solo las suyas.
- **Inicio:** «Necesita tu atención» muestra los reportes pendientes; los urgentes
  aparecen en rojo.

Las novedades de Alojamientos (quejas, convivencia) siguen igual.

## Validación local

```sh
npm run lint
npm run build
node tests/maintenance.mjs <ruta>/@electric-sql/pglite/dist/index.js
```

Cubre la conversión de roles, la lectura restringida, la creación y visibilidad de
reportes por rol, la gestión por administración, las áreas y la migración repetible.
