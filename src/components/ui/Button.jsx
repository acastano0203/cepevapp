import { cn } from '@/lib/utils'

const VARIANTS = {
  primary:
    'bg-navy-600 text-white shadow-sm hover:bg-navy-700 active:bg-navy-800 disabled:hover:bg-navy-600',
  secondary:
    'bg-white text-navy-700 border border-line shadow-xs hover:bg-navy-50 active:bg-navy-100',
  ghost: 'text-navy-700 hover:bg-navy-50 active:bg-navy-100',
  gold: 'bg-gold-500 text-navy-900 shadow-sm hover:bg-gold-400 active:bg-gold-600',
  danger: 'bg-[var(--color-danger-fg)] text-white hover:opacity-90',
  subtle: 'bg-navy-50 text-navy-700 hover:bg-navy-100',
}

const SIZES = {
  sm: 'h-9 px-3 text-xs gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-sm gap-2',
  icon: 'h-10 w-10 justify-center',
}

export function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  className,
  loading = false,
  disabled,
  children,
  ...props
}) {
  return (
    <Component
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </Component>
  )
}
