import { createClient } from '@supabase/supabase-js'

// Se normalizan: Vercel puede entregar la variable vacia ("") si se guardo sin
// valor, y una cadena vacia haria explotar a createClient antes de montar React.
const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const missingEnvVars = [
  !url && 'VITE_SUPABASE_URL',
  !anonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean)

export const isSupabaseConfigured = missingEnvVars.length === 0

if (!isSupabaseConfigured) {
  console.error(
    `[CEPEV] Falta configurar: ${missingEnvVars.join(' y ')}. ` +
      'En desarrollo van en el archivo .env; en Vercel, en Settings -> Environment Variables ' +
      '(y hay que volver a desplegar para que la compilacion las tome).',
  )
}

// Con valores de reserva la aplicacion arranca igual y puede mostrar una
// pantalla explicativa en lugar de una pagina en blanco.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Normaliza los errores de PostgREST a un mensaje legible en espanol.
 * Las funciones del dominio lanzan errcode P0001 con el texto ya redactado.
 */
export function toFriendlyError(error) {
  if (!error) return 'Ocurrio un error inesperado.'
  const message = error.message ?? String(error)

  if (error.code === 'P0001' || message.includes('P0001')) {
    return message.replace(/^.*?P0001[:\s]*/i, '')
  }
  if (error.code === '23505') return 'Ya existe un registro con esos datos.'
  if (error.code === '23514') return 'Alguno de los valores no cumple las reglas del centro.'
  if (error.code === '23P01') return 'Hay un cruce de fechas con otro registro.'
  if (error.code === '42501' || message.includes('row-level security')) {
    return 'Tu perfil no tiene permiso para esta operacion.'
  }
  if (message.includes('Invalid login credentials')) return 'Correo o contrasena incorrectos.'
  if (message.includes('Email not confirmed')) return 'Debes confirmar tu correo antes de ingresar.'
  if (message.includes('Failed to fetch')) return 'Sin conexion con el servidor. Revisa tu red.'

  return message
}

/** Envuelve una consulta de Supabase y lanza un error ya traducido. */
export async function runQuery(promise) {
  const { data, error } = await promise
  if (error) throw new Error(toFriendlyError(error))
  return data
}
