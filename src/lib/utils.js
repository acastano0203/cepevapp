import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/* ---------------------------------------------------------------------------
 * Fechas (zona horaria de Colombia, sin dependencias del navegador del usuario)
 * ------------------------------------------------------------------------ */
const TZ = 'America/Bogota'

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatDate(iso, options = { day: 'numeric', month: 'short' }) {
  if (!iso) return '—'
  return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', options)
}

export function formatLongDate(iso) {
  return formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(value) {
  if (!value) return '—'
  return String(value).slice(0, 5)
}

export function relativeTime(value) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'hace un momento'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return formatDate(value)
}

export function ageFrom(isoBirth) {
  if (!isoBirth) return '—'
  const birth = new Date(`${isoBirth}T12:00:00`)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
}

/* ---------------------------------------------------------------------------
 * Numeros
 * ------------------------------------------------------------------------ */
export function formatNumber(value) {
  return new Intl.NumberFormat('es-CO').format(value ?? 0)
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value ?? 0)
}

export function percent(value, total) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

/* ---------------------------------------------------------------------------
 * Texto
 * ------------------------------------------------------------------------ */
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function matches(haystack, needle) {
  if (!needle) return true
  return normalize(haystack).includes(normalize(needle))
}
