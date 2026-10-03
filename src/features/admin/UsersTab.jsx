import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Pencil, Trash2, UserPlus } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  Input,
  QueryBoundary,
  SearchInput,
  Select,
  Table,
  Td,
  Tr,
} from '@/components/ui'
import { useAdminActions, useAdminUsers } from '@/hooks/useCepev'
import { useAuth } from '@/lib/auth'
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '@/lib/constants'
import { formatDateTime, matches } from '@/lib/utils'

const ROLE_OPTIONS = ['admin', ...ASSIGNABLE_ROLES].map((role) => ({ value: role, label: ROLE_LABELS[role] }))
const ROLE_TONES = { admin: 'navy', servidor: 'gold', capitan: 'gold', cepevista: 'neutral' }

/** Contraseña temporal legible: sin caracteres que se confunden (0/O, 1/l). */
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const values = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(values, (value) => chars[value % chars.length]).join('')
}

/** Alta y edición. Al editar, la contraseña es opcional: vacía = no cambia. */
function UserDialog({ user, onClose, isSelf }) {
  const actions = useAdminActions()
  const isNew = !user
  const [form, setForm] = useState({
    id: user?.id ?? null,
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    original_email: user?.email ?? '',
    role: user?.role ?? 'cepevista',
    password: isNew ? generatePassword() : '',
  })
  const [showPassword, setShowPassword] = useState(isNew)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const mutation = isNew ? actions.createUser : actions.updateUser
  const submit = (event) => {
    event.preventDefault()
    mutation.mutate(form, { onSuccess: onClose })
  }

  return (
    <Dialog open onClose={() => { if (!mutation.isPending) onClose() }}
      title={isNew ? 'Nuevo usuario' : `Editar a ${user.full_name}`}
      description={isNew
        ? 'La cuenta queda activa de inmediato. Entrega el correo y la contraseña a la persona.'
        : 'Deja la contraseña vacía para no cambiarla.'}
      footer={<>
        <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="user-form" loading={mutation.isPending}>{isNew ? 'Crear usuario' : 'Guardar cambios'}</Button>
      </>}>
      <form id="user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre completo *" className="sm:col-span-2" required value={form.full_name} onChange={set('full_name')}
          autoComplete="off" />
        <Input label="Correo *" type="email" required value={form.email} onChange={set('email')} autoComplete="off" />
        <Select label="Perfil *" value={form.role} onChange={set('role')} options={ROLE_OPTIONS} disabled={isSelf}
          hint={isSelf ? 'No puedes cambiar tu propio perfil' : 'Define qué módulos ve en el menú'} />
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <div className="flex items-end gap-2">
            <Input label={isNew ? 'Contraseña *' : 'Nueva contraseña'} className="flex-1"
              type={showPassword ? 'text' : 'password'} required={isNew} minLength={8} value={form.password}
              onChange={set('password')} autoComplete="new-password" placeholder={isNew ? '' : 'Sin cambios'} />
            <Button type="button" variant="secondary" size="icon" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setForm((current) => ({ ...current, password: generatePassword() })); setShowPassword(true) }}>
              <KeyRound /> Generar
            </Button>
          </div>
          <span className="text-xs text-ink-soft">Mínimo 8 caracteres. Pide a la persona cambiarla cuando ingrese.</span>
        </div>
      </form>
    </Dialog>
  )
}

/** Grilla de usuarios: solo el administrador crea, edita y elimina. */
export function UsersTab() {
  const { user: me } = useAuth()
  const query = useAdminUsers()
  const actions = useAdminActions()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | fila
  const [deleting, setDeleting] = useState(null)

  const users = query.data ?? []
  const rows = users.filter((row) => (!role || row.role === role) && matches(`${row.full_name} ${row.email}`, search))
  const admins = users.filter((row) => row.role === 'admin').length

  return (
    <Card>
      <CardHeader title="Usuarios"
        description="Solo el administrador crea cuentas. Cada usuario ve los módulos que tenga marcados su perfil."
        action={<Button onClick={() => setEditing('new')}><UserPlus /> Nuevo usuario</Button>} />
      <div className="flex flex-wrap gap-3 border-b border-[#edf1f5] px-4 py-3 sm:px-6">
        <SearchInput placeholder="Buscar por nombre o correo" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select aria-label="Perfil" className="w-full sm:w-48" value={role} onChange={(event) => setRole(event.target.value)}
          placeholder="Todos los perfiles" options={ROLE_OPTIONS} />
      </div>
      <QueryBoundary query={query} loadingLabel="Cargando usuarios…" empty="No hay usuarios registrados.">
        <Table columns={['Usuario', 'Perfil', 'Último ingreso', 'Creado', '']}>
          {rows.map((row) => {
            const isSelf = row.id === me?.id
            const lastAdmin = row.role === 'admin' && admins <= 1
            return (
              <Tr key={row.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={row.full_name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {row.full_name}{isSelf && <span className="ml-2 text-xs font-normal text-ink-soft">(tú)</span>}
                      </p>
                      <p className="truncate text-xs text-ink-soft">{row.email}</p>
                    </div>
                  </div>
                </Td>
                <Td><Badge tone={ROLE_TONES[row.role]}>{ROLE_LABELS[row.role] ?? row.role}</Badge></Td>
                <Td className="text-ink-soft">{row.last_sign_in_at ? formatDateTime(row.last_sign_in_at) : 'Nunca'}</Td>
                <Td className="text-ink-soft">{formatDateTime(row.created_at)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Editar a ${row.full_name}`} onClick={() => setEditing(row)}>
                      <Pencil />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Eliminar a ${row.full_name}`}
                      disabled={isSelf || lastAdmin}
                      title={isSelf ? 'No puedes eliminar tu propio usuario' : lastAdmin ? 'Debe quedar al menos un administrador' : undefined}
                      onClick={() => setDeleting(row)}>
                      <Trash2 />
                    </Button>
                  </div>
                </Td>
              </Tr>
            )
          })}
        </Table>
        {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-ink-soft">Nadie coincide con la búsqueda.</p>}
      </QueryBoundary>

      {editing && (
        <UserDialog user={editing === 'new' ? null : editing} isSelf={editing !== 'new' && editing.id === me?.id}
          onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => { if (!actions.deleteUser.isPending) setDeleting(null) }}
        loading={actions.deleteUser.isPending}
        title={deleting ? `Eliminar a ${deleting.full_name}` : ''}
        description="La persona ya no podrá ingresar. Lo que registró (pagos, reportes, bitácora) se conserva. No se puede deshacer."
        confirmLabel="Eliminar usuario"
        onConfirm={() => actions.deleteUser.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null) })} />
    </Card>
  )
}
