# CEPEV · Gestión integral

Aplicación web para coordinar la operación diaria del Centro de Perfeccionamiento de Líderes y
Colportores: **cocina, alojamientos, flota y colportaje**, con reglas de negocio aplicadas en la
base de datos y acceso por rol.

> Reescritura del prototipo HTML de una sola página como aplicación **React + Tailwind CSS v4 +
> Supabase**, lista para desplegar en Vercel.

---

## 1. Requisitos

| Herramienta | Versión mínima |
| ----------- | -------------- |
| Node.js     | 20             |
| npm         | 10             |
| Supabase    | Proyecto con PostgreSQL 15 o superior |

## 2. Puesta en marcha

```bash
npm install
cp .env.example .env     # en Windows: copy .env.example .env
npm run dev
```

Completa `.env` con los datos de **Supabase → Project Settings → API**:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Opcional: coloca el logotipo institucional en `public/logo.jpg` (si no existe, la barra lateral
muestra un monograma).

## 3. Base de datos

En **Supabase Studio → SQL Editor**, ejecuta los archivos de la carpeta `supabase/` **en orden**:

| Archivo             | Qué hace |
| ------------------- | -------- |
| `01_schema.sql`     | Extensiones, tipos, tablas, índices y restricciones de exclusión (evitan camas y vehículos con reservas solapadas). |
| `02_views.sql`      | Funciones de apoyo (`cepev_today`, `person_city_on`, rol del usuario) y vistas de lectura del panel. |
| `03_rls.sql`        | Row Level Security: quién lee y quién escribe. |
| `04_functions.sql`  | Reglas de negocio como RPC (`kitchen_assign`, `stay_create`, `trip_create`, `sale_register`…). |
| `05_seed.sql`       | **Opcional.** Escenario de ejemplo: 420 camas, 336 residentes, 12 colportores, 7 vehículos. |
| `06_admin.sql`      | Asignar el rol `admin` a tu usuario después de registrarte. |

### Roles

| Rol           | Permisos |
| ------------- | -------- |
| `consulta`    | Solo lectura (valor por defecto de toda cuenta nueva). |
| `coordinador` | Lectura y escritura operativa. |
| `admin`       | Todo, incluida la gestión de roles y el borrado. |

Flujo recomendado: crea tu cuenta desde la pantalla de ingreso de la app y luego ejecuta el
`update` de `06_admin.sql` con tu correo para convertirte en administrador.

### Por qué las reglas viven en la base de datos

La interfaz valida para guiar, pero **la última palabra la tiene PostgreSQL**:

- *Exclusion constraints* impiden que una cama, un vehículo o un conductor queden con dos
  reservas superpuestas, incluso si dos coordinadores guardan al mismo tiempo.
- Las funciones `security definer` verifican rol, disponibilidad, sexo de la habitación, ciudad
  de la persona ese día y cruces con turnos de cocina antes de escribir.
- Cada operación deja registro en `audit_log`, que alimenta el bloque «Últimos movimientos».

## 4. Estructura del proyecto

```
src/
├─ components/
│  ├─ ui/          Primitivas reutilizables (Button, Card, Dialog, Table, Field…)
│  └─ layout/      AppShell, Sidebar responsive, PageHeader
├─ pages/          Un archivo por módulo (carga diferida con React.lazy)
├─ hooks/          useCepev.js · hooks de React Query + invalidación centralizada
└─ lib/
   ├─ supabase.js  Cliente y traducción de errores de PostgREST
   ├─ api.js       Capa de acceso a datos (consultas y RPC)
   ├─ auth.jsx     Sesión, perfil y permisos
   ├─ constants.js Menú, etiquetas y catálogos
   └─ utils.js     Fechas en zona horaria de Colombia, formatos y texto
```

### Cómo crecer sin romper nada

- **Nuevo módulo:** agrega la ruta en `src/App.jsx`, la entrada en `NAV_ITEMS`
  (`src/lib/constants.js`) y su página en `src/pages/`.
- **Nueva operación:** crea la función SQL en `04_functions.sql`, expónla en `src/lib/api.js` y
  envuélvela con `useAppMutation` en `src/hooks/useCepev.js` para obtener avisos e invalidación
  de caché automáticos.
- **Nuevo indicador:** añádelo a la vista `v_dashboard` y píntalo con `<KpiCard>`.

## 5. Responsive y accesibilidad

- Barra lateral fija en escritorio y cajón deslizable en móvil.
- Áreas táctiles de 44 px como mínimo en botones y campos.
- Tablas con desplazamiento horizontal propio: la página nunca se desborda.
- Modal con foco atrapado, cierre con `Escape` y retorno del foco al origen.
- Respeta `prefers-reduced-motion`.

## 6. Scripts

```bash
npm run dev       # servidor de desarrollo
npm run build     # compilación de producción en dist/
npm run preview   # previsualizar la compilación
npm run lint      # ESLint
```

## 7. Despliegue en Vercel

1. Sube el repositorio a GitHub.
2. En Vercel: **Add New → Project → Import** el repositorio.
3. Framework preset: **Vite** (ya viene configurado en `vercel.json`).
4. En **Settings → Environment Variables** agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
   para *Production*, *Preview* y *Development*.
5. **Deploy**.

Después del despliegue, añade la URL de Vercel en
**Supabase → Authentication → URL Configuration → Site URL / Redirect URLs**.

---

Los datos del `seed` son ficticios y sirven para conocer la aplicación antes de cargar información real.
