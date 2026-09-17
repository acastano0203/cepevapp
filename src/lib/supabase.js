import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[CEPEV] Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
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
