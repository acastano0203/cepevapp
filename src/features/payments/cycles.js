import { todayISO } from '@/lib/utils'

/**
 * Mismas reglas que supabase/25_payments.sql (payment_sync_charges), para
 * mostrar en pantalla cómo quedará una cuenta antes de guardarla.
 */

/** Inicio del ciclo k: fecha de ingreso + k meses (día ajustado al fin de mes). */
export function cycleStart(entryDate, k) {
  const [year, month, day] = entryDate.split('-').map(Number)
  const last = new Date(Date.UTC(year, month - 1 + k + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + k, Math.min(day, last))).toISOString().slice(0, 10)
}

export const daysBetween = (from, to) =>
  Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000)

/** Cuota del ciclo k: fecha de vencimiento y valor. null si el ciclo no existe. */
export function cycleCharge(entryDate, k, { concept, rate, closedOn }) {
  const start = cycleStart(entryDate, k)
  if (closedOn && start >= closedOn) return null
  const next = cycleStart(entryDate, k + 1)
  if (concept === 'Por dias') {
    if (!closedOn) return null
    const due = next < closedOn ? next : closedOn
    const days = daysBetween(start, due)
    return { start, due, days, amount: days * Number(rate || 0) }
  }
  return { start, due: next, days: daysBetween(start, next), amount: Number(rate || 0) }
}

/** Fecha en que vence la primera cuota. */
export function firstDueDate(entryDate, options = {}) {
  if (!entryDate) return null
  return cycleCharge(entryDate, 0, options)?.due ?? cycleStart(entryDate, 1)
}

/** Total de la estadía por días (todos sus tramos). */
export function dailyStayTotal(entryDate, closedOn, rate) {
  if (!entryDate || !closedOn || closedOn <= entryDate) return null
  const days = daysBetween(entryDate, closedOn)
  return { days, amount: days * Number(rate || 0) }
}

/** Lo que pasará al abrir la cuenta hoy: cuotas generadas, vencidas y la próxima. */
export function previewAccount(entryDate, { concept, rate, closedOn } = {}) {
  if (!entryDate) return null
  const today = todayISO()
  const first = cycleCharge(entryDate, 0, { concept, rate, closedOn })
  if (!first) return null
  if (entryDate > today) return { started: 0, overdue: 0, overdueAmount: 0, firstDue: first.due, firstAmount: first.amount }
  let started = 0
  let overdue = 0
  let overdueAmount = 0
  let next = null
  for (let k = 0; k < 600; k += 1) {
    const charge = cycleCharge(entryDate, k, { concept, rate, closedOn })
    if (!charge || charge.start > today) break
    started += 1
    if (charge.due < today) {
      overdue += 1
      overdueAmount += charge.amount
    } else if (!next) {
      next = charge
    }
  }
  return { started, overdue, overdueAmount, nextDue: next?.due ?? null, firstDue: first.due, firstAmount: first.amount }
}
