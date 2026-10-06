# CEPEV instalable desde Chrome

Implementación preparada sobre `main`, commit `3a79159`, del repositorio
`acastano0203/cepevapp`. La PWA mantiene React, Vite, Vercel y Supabase.

## Qué incorpora

- Manifiesto con nombre CEPEV, idioma español, inicio `/` y ventana independiente.
- Iconos PNG de 192 y 512 píxeles, icono adaptable y apple-touch-icon.
  Se derivan del favicon azul y dorado que ya usa el repositorio.
- Botón «Instalar CEPEV» cuando Chrome emite la invitación de instalación.
  Si el usuario lo descarta, puede usar el menú del navegador.
- Service worker que almacena solamente archivos públicos de la aplicación.
- Aviso de nueva versión con confirmación antes de recargar.
- Comprobación de actualizaciones al regresar a la pestaña, recuperar conexión
  y cada hora mientras la página está visible.
- Aviso sin conexión y página alternativa al intentar abrir una ruta sin red.
- Cabeceras de Vercel para revalidar el manifiesto y el service worker.

La instalación no convierte esta aplicación en un sistema de trabajo sin internet.
Los datos, el acceso y las operaciones de Supabase siguen necesitando conexión.
La PWA no añade caché de respuestas de Supabase ni cola de escrituras en segundo plano.
No requiere ejecutar SQL, cambiar tablas ni modificar permisos de la base de datos.
Los permisos y sesiones actuales siguen aplicándose.

## Archivos modificados

| Archivo | Función |
| --- | --- |
| `vite.config.js` | Configuración del manifiesto y generación del service worker. |
| `package.json`, `package-lock.json` | Dependencias `vite-plugin-pwa` y `workbox-window`. |
| `src/main.jsx` | Monta una vez los controles de instalación y actualización. |
| `src/components/pwa/PwaControls.jsx` | Invitación de instalación, conexión y actualizaciones. |
| `src/components/pwa/pwa.css` | Estilos propios del aviso. |
| `index.html` | Metadatos adicionales e icono para pantalla de inicio. |
| `public/icons/` | Iconos instalables basados en el favicon existente. |
| `public/offline.html` | Mensaje cuando no se puede acceder al sitio. |
| `vercel.json` | Cabeceras de actualización. |

`manifest.webmanifest` y `sw.js` se generan en `dist/` al compilar; no se editan allí.
El despliegue previsto es en la raíz de un dominio Vercel. Publicar bajo una
subcarpeta de GitHub Pages requeriría adaptar base, rutas, scope e iconos.

## Aplicar el parche desde VS Code / PowerShell

El ZIP contiene un parche Git con los cambios y los iconos. No reemplaces toda tu
carpeta de trabajo: la captura muestra cambios locales en varios módulos.

1. Extrae `cepev-pwa.patch` del ZIP en una carpeta externa al repositorio, por
   ejemplo `C:\Cambios-CEPEV`. Abre la terminal en la raíz de tu proyecto.
2. Revisa el trabajo pendiente y crea una rama desde tu rama actual:

```powershell
git status
git switch -c mejora/instalacion-pwa
```

Si ya estás en una rama para PWA, omite el segundo comando. Los cambios locales
pendientes continúan en tu carpeta; crear una rama no los publica ni los borra.

3. Comprueba que el parche encaja en tus archivos:

```powershell
git apply --check C:\Cambios-CEPEV\cepev-pwa.patch
```

Si termina sin errores, aplícalo:

```powershell
git apply C:\Cambios-CEPEV\cepev-pwa.patch
npm ci
```

Si la comprobación falla, no reemplaces archivos completos ni uses comandos para
descartar cambios. Tu copia difiere de la base revisada. Pide a Codex en VS Code:

> Integra los cambios del archivo C:\Cambios-CEPEV\cepev-pwa.patch en este
> proyecto, conservando mis cambios locales. Aplica únicamente la funcionalidad
> PWA; fusiona las adiciones de vite.config.js, src/main.jsx, index.html,
> vercel.json y package.json. Regenera package-lock.json con npm si hace falta.
> No modifiques los módulos de negocio ni los SQL. Compila y comprueba el
> manifiesto, los iconos y el registro del service worker. No publiques todavía.

## Probar antes de publicar

Conserva tu `.env` local configurado con las variables de Supabase existentes.
Prueba la PWA con la compilación de producción, no con `npm run dev`:

```powershell
npm run build
npm run preview -- --host 127.0.0.1
```

Abre en Chrome la URL que muestre la terminal, normalmente
`http://127.0.0.1:4173`. El equipo local es una excepción permitida a HTTPS.
Para acceder desde otro dispositivo, prueba el despliegue HTTPS de Vercel.

1. Abre F12 → Application → Manifest. Confirma nombre CEPEV, iconos y modo standalone.
2. En Application → Service Workers, confirma `sw.js` activo.
3. Busca «Instalar CEPEV» en la página cuando Chrome habilite la invitación,
   o utiliza la opción de instalación del menú de Chrome.
4. Instala y abre desde el nuevo icono. Debe abrir una ventana independiente.
5. Comprueba ingreso y navegación a tus módulos habituales con conexión.
6. Activa Offline en las herramientas de desarrollo: al navegar o recargar debe
   aparecer el mensaje de conexión. Vuelve a Online y pulsa «Volver a intentar».
7. Para probar una actualización real, deja la app abierta, publica una segunda
   versión con un cambio visible y vuelve a la ventana. Debe ofrecer actualizar;
   no debe recargar silenciosamente un formulario abierto.

La aparición de la invitación depende de Chrome, de que no esté instalada ya y
de las políticas del equipo. No pruebes con `file://`, modo incógnito o un
iframe. No se incluye ningún anuncio que afirme que los datos funcionan offline.

## Subir y publicar

Revisa `git diff` y los archivos preparados antes de hacer el commit. Puedes usar
el panel de control de código fuente de VS Code para seleccionar solo lo que
quieres incluir. Después haz commit y envía tu rama:

```powershell
git push -u origin mejora/instalacion-pwa
```

Abre un Pull request en GitHub hacia la rama de producción que uses. Revisa la
vista previa de Vercel, si está habilitada, y luego integra el cambio. La
publicación requiere las variables de Supabase configuradas en ese entorno.
Tras el despliegue exitoso, instala desde la dirección HTTPS definitiva, por
ejemplo `https://cepevapp.vercel.app`, para que el icono apunte a producción.

Una rama de código o una vista previa de Vercel no crean otra base de datos:
las variables configuradas determinan a qué proyecto de Supabase se conecta.

## Validación realizada al preparar esta entrega

- Compilación de producción completada con Vite y generación de service worker.
- ESLint de la configuración y el componente PWA sin errores.
- Comprobación de manifiesto, enlaces, dimensiones PNG y archivo sin conexión.
- Comprobación de que la navegación usa red con alternativa sin conexión y que
  no se han añadido reglas de caché para Supabase.
- Aplicación del parche comprobada sobre la revisión base.

No se ha publicado esta modificación ni probado una instalación interactiva en
tu Chrome. No se accedió a tu base de datos para esta entrega.

## Referencias

- https://vite-pwa-org.netlify.app/guide/
- https://vite-pwa-org.netlify.app/frameworks/react
- https://developer.chrome.com/docs/workbox/modules/workbox-build
