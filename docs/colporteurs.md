# Colportores: equipos, rotaciones y reportes

## Activación

Rama de trabajo: `rama-colportores`.

Ejecuta `supabase/16_colporteur_teams_reports.sql` después de la migración 15,
en el SQL Editor del proyecto Supabase. Es una migración transaccional y se puede
volver a ejecutar. No ejecutes los archivos de reset para activar esta función.

El cambio de código no ejecuta la migración ni modifica datos remotos automáticamente.
Los equipos de la ficha de personas ahora se leen de `v_colporteur_teams`, por lo que
la migración debe estar aplicada antes de desplegar la nueva versión.

## Uso

### Equipos y rotaciones

1. En **Colportores → Equipos y rotaciones**, pulsa **Crear equipo**.
2. Busca un municipio o departamento y selecciona el municipio base.
3. El nombre del equipo se genera con ese municipio y su departamento.
4. Usa **Asignar colportor** para mover una persona a un equipo o dejarla sin equipo.
5. Usa **Programar rotación** para asignar un destino y fechas. La fecha de salida
   no se incluye: otro destino puede comenzar ese día.

El nombre visible del equipo sigue el municipio de su rotación vigente. Fuera de
una rotación, vuelve al municipio base. La tarjeta siempre muestra también la base.
Los equipos conservan su identificador aunque cambie el nombre. Solo puede haber
un equipo con cada municipio base; varios equipos pueden visitar el mismo destino.

Las rotaciones no se pueden superponer para un mismo equipo. Se pueden editar las
rotaciones vigentes o futuras y cancelar las futuras. Las finalizadas quedan visibles
al activar **Mostrar finalizadas**. Los cambios no reescriben la ciudad ni el equipo
de ventas ya registradas.

Los equipos anteriores que no coincidan inequívocamente con el catálogo se conservan.
La interfaz solicita **Asignar municipio** antes de nuevas asignaciones o rotaciones.
No se adivina el destino de un equipo con nombre ambiguo.

### Reportes

Los filtros incluyen periodo, nombre (sin distinguir tildes), municipio de la venta,
equipo y mínimo/máximo de libros por reporte diario. Se puede ordenar por fecha,
nombre o cantidad de libros.

Los cuatro indicadores reflejan todos los reportes filtrados:
- Libros vendidos.
- Colportores distintos con reportes.
- Reportes registrados, incluidos los de cero ventas.
- Promedio de libros por reporte.

Un día sin reporte no se considera un reporte con cero ventas. Los filtros numéricos
se aplican a cada reporte diario, no al total acumulado por persona. El nombre se
consulta de la ficha actual de la persona; municipio y equipo se conservan al registrar.

La tabla muestra 50 filas por página. Se descargan todas las páginas de Supabase para
evitar truncar los indicadores y las exportaciones al límite habitual de 1.000 filas.

### Exportaciones

- **CSV (Excel):** UTF-8 con BOM, delimitado por comas, columnas de detalle.
- **JSON:** periodo, filtros, indicadores y detalle.
- **Imprimir / guardar PDF:** abre la vista imprimible con periodo, filtros, indicadores
  y tabla completa; selecciona «Guardar como PDF» en el diálogo del navegador.
  Puede requerir permitir ventanas emergentes.

Todos exportan el conjunto filtrado completo. CSV protege los textos que podrían
interpretarse como fórmulas. La vista imprimible escapa el contenido de texto.

## Permisos e integración

Consulta puede leer y exportar. Coordinación y administración pueden gestionar
equipos, miembros, ventas y rotaciones; las operaciones quedan en auditoría.
La ciudad de procedencia sigue siendo un dato personal, no el destino del equipo.

Kitchen y Laundry consideran el municipio del equipo al verificar disponibilidad:
un equipo asignado fuera de Piedecuesta no puede cubrir turnos locales.
Cambiar el municipio base invalida publicaciones futuras afectadas.

## Catálogo territorial

Fuente: [DANE, DIVIPOLA MGN 2025, capa Municipio](https://geoportal.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2025/MapServer/317).
Consulta realizada el 1 de octubre de 2026.

Se guardan 1.122 entradas con códigos de cinco dígitos: 1.103 de tipo MUNICIPIO,
18 áreas no municipalizadas y una isla. Los nombres se presentan en mayúscula inicial
para facilitar lectura. La fuente original entrega nombres en mayúsculas.

El catálogo local `src/data/colombia-municipalities.json` y la semilla SQL contienen
los mismos códigos y nombres; actualizar ambos juntos al renovar la versión DANE.
La aplicación no depende del servicio externo al abrir el selector.

## Validación local

```sh
npm run lint
npm run build
npm install --prefix .colporteur-tests.local --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
node tests/colporteurs.mjs .colporteur-tests.local/node_modules/@electric-sql/pglite/dist/index.js
```

Los tests usan PostgreSQL embebido con usuarios ficticios. Cubren catálogo, filtros,
exportación, permisos, cambios de equipo, preservación histórica, rotaciones,
disponibilidad local y migración repetible. No se conectan a Supabase real.

La carga del esquema histórico en tests elimina antes la vista antigua de la migración
10, porque esa migración existente altera el orden de sus columnas. No se modifica
la migración histórica.

## Si aparecen objetos ausentes en la cache del esquema

Los errores sobre `v_colporteur_teams`, `rotations.municipality_code` o
`v_colporteur_report_rows` indican que la API no dispone del esquema nuevo.

1. Abre el **mismo proyecto Supabase** al que apunta `VITE_SUPABASE_URL`.
2. En **SQL Editor**, ejecuta **todo** `supabase/16_colporteur_teams_reports.sql`,
   no solo sus primeras lineas. Requiere que la migracion 15 este aplicada.
3. La consulta final debe mostrar `true` en las tres columnas.
4. Recarga la aplicacion.

Si el editor devuelve un error, la transaccion no debe considerarse aplicada:
resuelve ese error y ejecuta nuevamente el archivo completo. La migracion incluye
`NOTIFY pgrst, 'reload schema'`; refrescar la cache por si solo no crea vistas
ni columnas ausentes.
