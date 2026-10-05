import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import { PwaControls } from './components/pwa/PwaControls'
import { AuthProvider } from './lib/auth'
import './index.css'

// A deploy removes old hashed chunks; reload once to fetch the new index instead of a blank screen.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('cepev-chunk-reload') || 0)
  // At most one reload every 30s, so a chunk that fails offline cannot loop forever.
  if (Date.now() - last < 30_000) return
  sessionStorage.setItem('cepev-chunk-reload', String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <PwaControls />
          <App />
          <Toaster richColors position="bottom-right" closeButton />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
