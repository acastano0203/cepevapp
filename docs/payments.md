# Pagos: mensualidades, siembras, ofrendas y pagos en especie

## Activación

Ejecuta `supabase/25_payments.sql` completo en el SQL Editor del proyecto Supabase,
después de la migración 24. Se puede volver a ejecutar. La consulta final debe
mostrar `true` en las tres columnas. Luego, en **Pagos → Configuración**, un
administrador define los valores antes de abrir cuentas.

## Conceptos

| Concepto    | Quién paga  | Abona a la deuda | En especie |
|-------------|-------------|------------------|------------|
| Mensualidad | Cepevista (por mes) | Sí       | Sí         |
| Por días    | Cepevista (estadía corta) | Sí | Sí       |
| Siembra     | Colportor   | Sí               | Sí         |
| Ofrenda     | Cualquiera, o anónima | No     | No         |

Formas de pago: efectivo, transferencia (con referencia opcional) o especie.
En especie, la persona presta un servicio: el valor es **horas × valor hora** del
tipo de servicio. El servidor calcula el valor y guarda la tarifa usada.

## Ciclos y regla de mora

Cada cepevista o colportor tiene una **cuenta** con su fecha de ingreso.

- El ciclo *k* empieza en `ingreso + k meses` y vence en `ingreso + (k + 1) meses`.
  Dura 30 o 31 días según el mes (28 o 29 en febrero). Si el ingreso es un 31,
  en los meses más cortos vence el último día del mes y luego vuelve al 31.
- Al iniciar un ciclo se genera su cuota con el valor vigente de la cuenta.
- Los abonos cubren primero las cuotas más antiguas. Lo que sobra queda como
  saldo a favor.
- **Nadie puede pasar un mes debiendo:** si una cuota sigue pendiente después de
  su fecha límite, la cuenta pasa a **En mora** y aparece en el panel de inicio.

Estados de una cuenta, en orden de prioridad:

| Estado     | Significado |
|------------|-------------|
| En mora    | Una cuota pendiente pasó su fecha límite. |
| Por vencer | Una cuota pendiente vence dentro de los días de aviso configurados. |
| Pendiente  | Hay una cuota pendiente que aún no está por vencer. |
| Al día     | No hay saldo pendiente. |
| Cerrada    | La persona salió (fecha de salida) y no debe nada. |

### Por días

El cepevista de estadía corta paga **días × valor día**. Exige fecha de salida.
Una estadía de menos de un mes es una sola cuota que vence el día de salida. Si
dura más, se corta en ciclos mensuales para cumplir la regla de mora: cada tramo
cobra sus días y el último vence en la salida. Cambiar el concepto, la salida o el
valor día de una cuenta por días recalcula sus cuotas.

## Configuración (solo administración)

- **Mensualidad del cepevista**, **valor día del cepevista** y **valor de colportaje por meta (siembra)**:
  son los valores por defecto al abrir una cuenta. Cada cuenta puede tener un
  valor propio para becas o acuerdos.
- **Días de aviso:** cuántos días antes del vencimiento se avisa (0 a 28).
- **Tipos de servicio y valor hora:** se usan en los pagos en especie. Un servicio
  sin valor hora no se puede usar. Los servicios se desactivan, no se borran.

Cambiar una tarifa no modifica las cuotas ya generadas. Con la opción **Aplicar a
las cuentas abiertas**, el nuevo valor rige desde el próximo ciclo de cada cuenta.

## Operación

- **Alta desde la ficha:** al registrar un cepevista o colportor, la ficha incluye
  la sección **Cuenta de pagos**. El concepto no se pregunta: sale del tipo de
  persona (Mensualidad o Siembra). La sección pide la fecha de ingreso y el valor
  mensual; si se deja vacío, se usa el valor configurado. Opcionalmente registra
  el primer pago, con forma de pago, valor (vacío = cuota completa) y fecha. La
  cuenta y el pago se guardan juntos (`payment_enroll`). Si fallan, la ficha queda
  registrada y la persona aparece en Pagos como **Sin cuenta**. Al editar la
  ficha solo se muestra un resumen de la cuenta, con enlace a Pagos.
- **Estado de cuentas (por cobrar):** solo lista lo que falta por cobrar: En mora,
  Por vencer, Pendiente y **Sin cuenta** (con el botón **Abrir cuenta**). Quien está
  al día o tiene la cuenta cerrada no aparece; sus pagos se ven en **Pagos registrados**.
  Si se busca a alguien al día, se indica debajo de la tabla con acceso a su detalle
  y a editar su cuenta. Se pagina de 20 en 20.

- **Personas sin cuenta:** si hay cepevistas o colportores sin cuenta, el estado
  de cuentas muestra un aviso con **Revisar y abrir cuentas**. En la revisión,
  cada persona trae una fecha de ingreso sugerida: su primera estadía o, si no
  tiene, la fecha de creación de su ficha, con el origen indicado. También trae
  el valor configurado y una vista previa de cómo quedará su cuenta hoy («primera
  cuota vence…», «debe la cuota actual» o «quedará en mora»). Se pueden corregir
  fechas y valores y desmarcar personas. Las cuentas seleccionadas se abren todas
  juntas o ninguna (`payment_accounts_open`).
- **Editar cuenta:** si cambias la fecha de ingreso, todas las cuotas se recalculan
  y se pierden sus ajustes. Los pagos se conservan. La fecha de salida detiene los
  ciclos nuevos, pero la deuda pendiente se mantiene.
- **Ajustar cuota (administración):** permite becas, descuentos o correcciones.
  Exige un motivo.
- **Anular pago:** los pagos no se borran. Para anular uno hay que indicar el
  motivo, y el saldo se recalcula.

## Permisos

Todos los perfiles pueden leer. Coordinación y administración registran y anulan
pagos, y abren o editan cuentas. Solo administración cambia criterios, servicios y
cuotas. Las tablas no aceptan escritura directa: todo pasa por funciones y queda
en la bitácora.

Las cuotas se generan con `payment_sync_charges()`, que la app ejecuta al abrir el
estado de cuentas. La función es idempotente y no requiere tareas programadas.

## Validación local

```sh
npm run lint
npm run build
npm install --prefix .payments-tests.local --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
node tests/payments.mjs .payments-tests.local/node_modules/@electric-sql/pglite/dist/index.js
```

Los tests usan PostgreSQL embebido. Cubren ciclos de 30 y 31 días y fin de mes,
mora, aviso de vencimiento, abonos parciales, pagos en especie, ofrendas,
anulación, saldo a favor, cambio de tarifa, ajustes, cambio de ingreso, cierre,
apertura masiva, permisos por rol y migración repetible.
