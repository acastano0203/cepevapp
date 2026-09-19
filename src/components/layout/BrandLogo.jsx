import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * El logo se sirve desde public/. Se prueban varias extensiones para que
 * funcione tal como lo hayas guardado; si no existe ninguna, queda el
 * recuadro con el nombre del centro.
 */
const LOGO_SOURCES = ['/logo.jpg', '/logo.png', '/logo.webp', '/logo.svg']

export function BrandLogo({ className, fallbackClassName }) {
  const [attempt, setAttempt] = useState(0)
  const source = LOGO_SOURCES[attempt]

  if (!source) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl bg-white font-black tracking-tight text-navy-700',
          className,
          fallbackClassName,
        )}
      >
        CEPEV
      </div>
    )
  }

  return (
    <img
      src={source}
      alt="CEPEV · Centro de Perfeccionamiento de Líderes y Colportores"
      className={cn('rounded-xl bg-white object-contain p-1.5', className)}
      onError={() => setAttempt((current) => current + 1)}
    />
  )
}
