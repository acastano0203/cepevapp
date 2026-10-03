import { useMemo, useState } from 'react'
import { Info, RotateCcw, Save } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ImportTab } from '@/features/admin/ImportTab'
import { UsersTab } from '@/features/admin/UsersTab'
import { Badge, Button, Card, CardHeader, QueryBoundary, Table, Td, Tr } from '@/components/ui'
import { useAdminActions, useRoleModules } from '@/hooks/useCepev'
import { ASSIGNABLE_MODULES, ASSIGNABLE_ROLES, ROLE_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'accesos', label: 'Accesos por perfil' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'importar', label: 'Importar fichas' },
]

/** Conjunto de módulos marcados por perfil, a partir de las filas de role_modules. */
const toMatrix = (rows = []) => Object.fromEntries(ASSIGNABLE_ROLES.map((role) => [
  role, new Set(rows.filter((row) => row.role === role).map((row) => row.module)),
]))

const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item))

/** Checks de módulos por perfil. El admin ve todo y no se edita. */
function AccessMatrix() {
  const query = useRoleModules()
  const actions = useAdminActions()
  const saved = useMemo(() => toMatrix(query.data), [query.data])
  const [draft, setDraft] = useState(null)
  const matrix = draft ?? saved
  const changedRoles = ASSIGNABLE_ROLES.filter((role) => !sameSet(matrix[role], saved[role]))
  const pending = actions.setRoleModules.isPending

  const toggle = (role, module) => {
    const next = Object.fromEntries(ASSIGNABLE_ROLES.map((item) => [item, new Set(matrix[item])]))
    if (next[role].has(module)) next[role].delete(module)
    else next[role].add(module)
    setDraft(next)
  }

  const save = async () => {
    for (const role of changedRoles) {
      await actions.setRoleModules.mutateAsync({ role, modules: [...matrix[role]] })
    }
    setDraft(null)
  }

  return (
    <Card>
      <CardHeader title="Módulos visibles en el menú"
        description="Marca qué módulos ve cada perfil. El administrador siempre ve todo, incluida esta sección."
        action={<>
          <Button variant="secondary" disabled={!changedRoles.length || pending} onClick={() => setDraft(null)}>
            <RotateCcw /> Descartar
          </Button>
          <Button disabled={!changedRoles.length} loading={pending} onClick={() => { save().catch(() => {}) }}>
            <Save /> Guardar cambios
          </Button>
        </>} />
      <QueryBoundary query={query} loadingLabel="Cargando accesos…">
        <Table columns={['Módulo', 'Administrador', ...ASSIGNABLE_ROLES.map((role) => ROLE_LABELS[role])]}>
          {ASSIGNABLE_MODULES.map(({ module, label, icon: Icon, description }) => (
            <Tr key={module}>
              <Td>
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-navy-500" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{label}</p>
                    <p className="text-xs text-ink-soft">{description}</p>
                  </div>
                </div>
              </Td>
              <Td>
                <input type="checkbox" checked disabled aria-label={`Administrador ve ${label}`} className="size-4" />
              </Td>
              {ASSIGNABLE_ROLES.map((role) => {
                const checked = matrix[role]?.has(module) ?? false
                const changed = checked !== (saved[role]?.has(module) ?? false)
                return (
                  <Td key={role} className={cn(changed && 'bg-gold-100/60')}>
                    <input type="checkbox" className="size-4 cursor-pointer" checked={checked} disabled={pending}
                      aria-label={`${ROLE_LABELS[role]} ve ${label}`} onChange={() => toggle(role, module)} />
                  </Td>
                )
              })}
            </Tr>
          ))}
          <Tr>
            <Td className="text-xs font-semibold text-ink-soft uppercase">Total</Td>
            <Td className="text-xs text-ink-soft">Todos</Td>
            {ASSIGNABLE_ROLES.map((role) => (
              <Td key={role} className="text-xs text-ink-soft">
                {matrix[role]?.size ? `${matrix[role].size} módulos` : <Badge tone="gold">Sin acceso</Badge>}
              </Td>
            ))}
          </Tr>
        </Table>
        <div className="flex gap-3 border-t border-[#edf1f5] bg-navy-50/60 px-4 py-3 text-sm text-ink-soft sm:px-6">
          <Info className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden="true" />
          <ul className="list-disc space-y-1 pl-4">
            <li>Los perfiles distintos del administrador ven sus módulos <strong className="text-ink">en modo lectura</strong>: solo el administrador crea, edita o borra.</li>
            <li>Con <strong className="text-ink">Mantenimiento</strong> marcado, el perfil puede reportar daños y ver sus reportes.</li>
            <li>Marcar cualquier otro módulo permite consultar la información de la operación desde la app.</li>
            <li>Los cambios se aplican cuando cada usuario vuelve a ingresar o recarga la página.</li>
          </ul>
        </div>
      </QueryBoundary>
    </Card>
  )
}

export default function Administration() {
  const [tab, setTab] = useState('accesos')

  return (
    <>
      <PageHeader title="Administración" subtitle="Perfiles de usuario y módulos que ve cada perfil. Solo para el administrador." />
      <div role="tablist" aria-label="Secciones de administración" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((item) => (
          <button key={item.id} role="tab" type="button" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={'relative -mb-px min-h-11 px-3 text-sm font-medium transition-colors sm:px-4 '
              + (tab === item.id ? 'border-b-2 border-navy-600 text-navy-700' : 'border-b-2 border-transparent text-ink-soft hover:text-ink')}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'accesos' && <AccessMatrix />}
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'importar' && <ImportTab />}
    </>
  )
}
