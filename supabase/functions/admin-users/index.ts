// ============================================================================
// CEPEV · Edge Function admin-users
//
//   Crear, editar y eliminar usuarios de la app. Solo la invoca un usuario con
//   perfil admin: la llave de servicio vive aqui, nunca en el navegador.
//
//   POST { action: 'create', email, password, full_name, role }
//   POST { action: 'update', id, email?, password?, full_name, role }
//   POST { action: 'delete', id }
//
//   Reglas: nadie se quita a si mismo el perfil de admin ni se elimina, y
//   siempre debe quedar al menos un administrador.
//
//   Despliegue: supabase functions deploy admin-users
//   (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los provee
//   Supabase automaticamente.)
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ROLES = ['admin', 'servidor', 'capitan', 'cepevista']
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const friendly = (message = '') => {
  if (/already (been )?registered|already exists/i.test(message)) return 'Ya existe un usuario con ese correo.'
  if (/password/i.test(message)) return 'La contraseña no cumple los requisitos (mínimo 8 caracteres).'
  return message || 'No se pudo completar la operación.'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Método no permitido.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // Quien llama debe tener sesión y perfil admin
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    })
    const { data: auth } = await caller.auth.getUser()
    if (!auth?.user) throw new AppError('Tu sesión expiró. Ingresa de nuevo.', 401)
    const { data: me } = await admin.from('profiles').select('id, full_name, role').eq('id', auth.user.id).single()
    if (me?.role !== 'admin') throw new AppError('Solo el administrador gestiona usuarios.', 403)

    const body = await req.json().catch(() => ({}))
    const audit = (action: string, entityId: string, summary: string) =>
      admin.from('audit_log').insert({
        actor_id: me.id, actor_name: me.full_name, action, entity: 'profiles', entity_id: entityId, summary,
      })
    const adminCount = async () => {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      return count ?? 0
    }
    const fullName = String(body.full_name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const role = String(body.role ?? '')

    if (body.action === 'create') {
      if (!fullName) throw new AppError('Indica el nombre completo.')
      if (!EMAIL.test(email)) throw new AppError('El correo no tiene un formato válido.')
      if (password.length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres.')
      if (!ROLES.includes(role)) throw new AppError('Selecciona un perfil válido.')

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      })
      if (error) throw new AppError(friendly(error.message))
      // El trigger handle_new_user crea el perfil; aquí se fijan nombre y perfil
      const { error: profileError } = await admin.from('profiles')
        .upsert({ id: data.user.id, full_name: fullName, role, updated_at: new Date().toISOString() })
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id)
        throw new AppError('No se pudo crear el perfil: ' + profileError.message)
      }
      await audit('admin_user_create', data.user.id, `Usuario creado: ${fullName} (${email}) · ${role}`)
      return reply(200, { id: data.user.id })
    }

    if (body.action === 'update') {
      const id = String(body.id ?? '')
      const { data: target } = await admin.from('profiles').select('id, full_name, role').eq('id', id).single()
      if (!target) throw new AppError('Usuario no encontrado.', 404)
      if (!fullName) throw new AppError('Indica el nombre completo.')
      if (!ROLES.includes(role)) throw new AppError('Selecciona un perfil válido.')
      if (id === me.id && role !== 'admin') throw new AppError('No puedes quitarte el perfil de administrador a ti mismo.')
      if (target.role === 'admin' && role !== 'admin' && (await adminCount()) <= 1) {
        throw new AppError('Debe quedar al menos un administrador.')
      }
      if (email && !EMAIL.test(email)) throw new AppError('El correo no tiene un formato válido.')
      if (password && password.length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres.')

      const changes: Record<string, unknown> = { user_metadata: { full_name: fullName } }
      if (email) { changes.email = email; changes.email_confirm = true }
      if (password) changes.password = password
      const { error } = await admin.auth.admin.updateUserById(id, changes)
      if (error) throw new AppError(friendly(error.message))

      const { error: profileError } = await admin.from('profiles')
        .update({ full_name: fullName, role, updated_at: new Date().toISOString() }).eq('id', id)
      if (profileError) throw new AppError(profileError.message)
      await audit('admin_user_update', id,
        `Usuario actualizado: ${fullName}` + (target.role !== role ? ` · ${target.role} -> ${role}` : '')
          + (password ? ' · contraseña cambiada' : ''))
      return reply(200, { id })
    }

    if (body.action === 'delete') {
      const id = String(body.id ?? '')
      if (id === me.id) throw new AppError('No puedes eliminar tu propio usuario.')
      const { data: target } = await admin.from('profiles').select('id, full_name, role').eq('id', id).single()
      if (!target) throw new AppError('Usuario no encontrado.', 404)
      if (target.role === 'admin' && (await adminCount()) <= 1) throw new AppError('Debe quedar al menos un administrador.')

      // El perfil se borra en cascada; los registros que creó conservan su historial
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) throw new AppError(friendly(error.message))
      await audit('admin_user_delete', id, `Usuario eliminado: ${target.full_name} (${target.role})`)
      return reply(200, { id })
    }

    throw new AppError('Acción no válida.')
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500
    return reply(status, { error: error instanceof Error ? error.message : String(error) })
  }
})
