import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './pwa.css'

// iOS Safari has no beforeinstallprompt: the only way to install is Share → Add to Home Screen.
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const IOS_HINT_KEY = 'cepev-ios-install-hint-dismissed'

function readIosHintDismissed() {
  try { return localStorage.getItem(IOS_HINT_KEY) === '1' } catch { return false }
}

export function PwaControls() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)
  const [dismissed, setDismissed] = useState(false)
  const [iosHintDismissed, setIosHintDismissed] = useState(readIosHintDismissed)
  const [registration, setRegistration] = useState(null)
  const [message, setMessage] = useState('')
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, worker) { setRegistration(worker) },
    onRegisterError(error) { console.error('No se pudo activar la instalación de CEPEV:', error) },
  })

  useEffect(() => {
    const beforeInstall = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null) }
    const onConnection = () => setOnline(navigator.onLine)
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('online', onConnection)
    window.addEventListener('offline', onConnection)
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('online', onConnection)
      window.removeEventListener('offline', onConnection)
    }
  }, [])

  useEffect(() => {
    if (!registration) return
    const check = () => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        registration.update().catch(() => {})
      }
    }
    const timer = window.setInterval(check, 60 * 60 * 1000)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [registration])

  async function install() {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(null)
    } catch {
      setMessage('Abre el menú de Chrome y busca la opción para instalar CEPEV.')
    }
  }

  async function update() {
    // Explicit consent avoids losing a form silently when a deployment changes.
    if (!window.confirm('¿Ya guardaste tus cambios? Se recargará CEPEV para aplicar la nueva versión.')) return
    try { await updateServiceWorker(true) } catch {
      setMessage('No se pudo actualizar. Revisa tu conexión e inténtalo de nuevo.')
    }
  }

  function dismissIosHint() {
    setIosHintDismissed(true)
    try { localStorage.setItem(IOS_HINT_KEY, '1') } catch { /* private mode: hide only for this visit */ }
  }

  const showInstall = installPrompt && !installed && !dismissed
  const showIosHint = isIos && !installed && !iosHintDismissed
  if (online && !needRefresh && !showInstall && !showIosHint && !message) return null

  return (
    <aside className="cepev-pwa" aria-label="Instalación y conexión">
      {!online && <p role="status">Sin conexión. Conéctate a internet para consultar y guardar registros.</p>}
      {needRefresh && <div className="cepev-pwa-row">
        <p role="status">Hay una nueva versión. Guarda tus cambios antes de actualizar.</p>
        <button type="button" onClick={update} disabled={!online}>Actualizar</button>
        <button type="button" className="cepev-pwa-secondary" onClick={() => setNeedRefresh(false)}>Más tarde</button>
      </div>}
      {showInstall && !needRefresh && <div className="cepev-pwa-row">
        <p>Abre CEPEV desde su propio icono.</p>
        <button type="button" onClick={install}>Instalar CEPEV</button>
        <button type="button" className="cepev-pwa-secondary" onClick={() => setDismissed(true)}>Ahora no</button>
      </div>}
      {showIosHint && !needRefresh && <div className="cepev-pwa-row">
        <p>Para instalar CEPEV en tu iPhone, toca <strong>Compartir</strong> (el cuadro con la flecha hacia arriba) y luego <strong>Agregar a pantalla de inicio</strong>.</p>
        <button type="button" className="cepev-pwa-secondary" onClick={dismissIosHint}>Entendido</button>
      </div>}
      {message && <p role="status">{message}</p>}
    </aside>
  )
}
