import { createClient } from 'npm:@supabase/supabase-js@2.105.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ActionBody = {
  action?: 'create' | 'reset-password' | 'delete-user' | 'revoke-passkeys' | 'complete-password-change'
  email?: string
  full_name?: string
  password?: string
  user_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRole) return json({ error: 'Configuración segura de Supabase incompleta.' }, 500)

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Sesión requerida.' }, 401)

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        experimental: { passkey: true },
      },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Sesión inválida.' }, 401)

    const callerId = userData.user.id
    const body = (await req.json().catch(() => ({}))) as ActionBody
    const action = body.action || 'create'

    // Esta acción la puede ejecutar el propio usuario después de cambiar su
    // contraseña temporal desde el navegador.
    if (action === 'complete-password-change') {
      const { error } = await admin
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', callerId)
      if (error) return json({ error: 'No se pudo finalizar el cambio de contraseña.' }, 500)
      return json({ message: 'Cambio de contraseña confirmado.' })
    }

    // Todas las demás acciones son exclusivas del administrador.
    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('role,active')
      .eq('id', callerId)
      .single()

    if (profileError || callerProfile?.role !== 'admin' || callerProfile?.active !== true) {
      return json({ error: 'Solo un administrador activo puede realizar esta acción.' }, 403)
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase()
      const fullName = String(body.full_name || '').trim()
      const password = String(body.password || '')
      if (!email || !fullName || password.length < 8) {
        return json({ error: 'Nombre, correo y contraseña de al menos 8 caracteres son obligatorios.' }, 400)
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (error || !data.user) return json({ error: error?.message || 'No se pudo crear el usuario.' }, 400)

      const { error: profileUpdateError } = await admin.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        role: 'asesor',
        active: true,
        must_change_password: true,
      }, { onConflict: 'id' })

      if (profileUpdateError) {
        await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined)
        return json({ error: 'La cuenta se creó, pero no se pudo preparar el perfil del asesor.' }, 500)
      }

      return json({ message: 'Asesor creado correctamente.', user_id: data.user.id })
    }

    const userId = String(body.user_id || '')
    if (!userId) return json({ error: 'Falta el usuario.' }, 400)
    if (userId === callerId && action === 'delete-user') return json({ error: 'No puedes eliminar tu propia cuenta de administrador.' }, 400)

    if (action === 'reset-password') {
      const password = String(body.password || '')
      if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400)

      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) return json({ error: error.message }, 400)

      await revokeAllPasskeys(admin, userId)
      const { error: flagError } = await admin
        .from('profiles')
        .update({ must_change_password: true, active: true })
        .eq('id', userId)
      if (flagError) return json({ error: 'La contraseña cambió, pero no se pudo marcar como temporal.' }, 500)

      return json({ message: 'Contraseña temporal actualizada.' })
    }

    if (action === 'revoke-passkeys') {
      const removed = await revokeAllPasskeys(admin, userId)
      return json({ message: removed ? `${removed} acceso(s) rápido(s) revocado(s).` : 'El asesor no tenía accesos rápidos registrados.' })
    }

    if (action === 'delete-user') {
      const { count, error: countError } = await admin
        .from('clientes')
        .select('id', { count: 'exact', head: true })
        .eq('asesor_id', userId)
        .is('archived_at', null)
      if (countError) return json({ error: 'No se pudo verificar la cartera del asesor.' }, 500)
      if ((count || 0) > 0) return json({ error: `El asesor todavía tiene ${count} cliente(s). Reasígnalos antes de eliminarlo.` }, 409)

      // Los registros antiguos que pudieran haber quedado archivados en una
      // versión previa se reasignan al admin; los clientes activos deben ser cero.
      const [hiddenClientsMove, quotesMove, followupsMove] = await Promise.all([
        admin.from('clientes').update({ asesor_id: callerId }).eq('asesor_id', userId),
        admin.from('cotizaciones').update({ asesor_id: callerId }).eq('asesor_id', userId),
        admin.from('seguimientos').update({ asesor_id: callerId }).eq('asesor_id', userId),
      ])
      if (hiddenClientsMove.error || quotesMove.error || followupsMove.error) {
        return json({ error: 'No se pudo reasignar el historial antes de eliminar al asesor.' }, 500)
      }

      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) return json({ error: error.message }, 400)
      return json({ message: 'Asesor eliminado correctamente.' })
    }

    return json({ error: 'Acción no reconocida.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500)
  }
})

async function revokeAllPasskeys(admin: any, userId: string): Promise<number> {
  try {
    const { data, error } = await admin.auth.admin.passkey.listPasskeys({ userId })
    if (error) return 0
    const rows = Array.isArray(data) ? data : (data?.passkeys || [])
    let removed = 0
    for (const passkey of rows) {
      const passkeyId = passkey?.id
      if (!passkeyId) continue
      const { error: deleteError } = await admin.auth.admin.passkey.deletePasskey({ userId, passkeyId })
      if (!deleteError) removed += 1
    }
    return removed
  } catch (_) {
    return 0
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
