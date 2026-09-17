import { cn } from '@/lib/utils'

/**
 * Tabla responsive: en móvil hace scroll horizontal dentro de su contenedor,
 * el resto de la página nunca se desborda.
 */
export function Table({ columns = [], children, className }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full min-w-[640px] caption-bottom text-sm', className)}>
        <thead className="bg-[#f8fafc]">
          <tr className="border-b border-[#edf1f5]">
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className="h-11 px-4 text-left text-xs font-semibold tracking-wide text-ink-soft uppercase"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Tr({ className, children, ...props }) {
  return (
    <tr className={cn('border-b border-[#edf1f5] last:border-0 hover:bg-navy-50/40', className)} {...props}>
      {children}
    </tr>
  )
}

export function Td({ className, children, ...props }) {
  return (
    <td className={cn('px-4 py-3 align-middle', className)} {...props}>
      {children}
    </td>
  )
}
