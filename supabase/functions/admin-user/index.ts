import { createClient } from 'npm:@supabase/supabase-js@2.105.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ActionBody = { action?: 'delete-user' | 'complete-password-change'; user_id?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRole) return json({ error: 'Configuración segura de Supabase incompleta.' }, 500)

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Sesión requerida.' }, 401)

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Sesión inválida.' }, 401)

    const callerId = userData.user.id
    const body = (await req.json().catch(() => ({}))) as ActionBody
    const action = body.action

    if (action === 'complete-password-change') {
      const { error } = await admin.from('profiles').update({ must_change_password: false }).eq('id', callerId)
      return error ? json({ error: 'No se pudo finalizar el cambio de contraseña.' }, 500) : json({ message: 'Cambio confirmado.' })
    }

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('role,active,approval_status')
      .eq('id', callerId)
      .single()

    if (callerError || caller?.role !== 'admin' || caller?.active !== true || caller?.approval_status !== 'approved') {
      return json({ error: 'Solo un administrador activo y aprobado puede realizar esta acción.' }, 403)
    }

    const userId = String(body.user_id || '')
    if (!userId) return json({ error: 'Falta el usuario.' }, 400)
    if (userId === callerId && action === 'delete-user') return json({ error: 'No puedes eliminar tu propia cuenta de administrador.' }, 400)

    if (action === 'delete-user') {
      const { count, error: countError } = await admin
        .from('clientes')
        .select('id', { count: 'exact', head: true })
        .eq('asesor_id', userId)
        .is('archived_at', null)

      if (countError) return json({ error: 'No se pudo verificar la cartera del asesor.' }, 500)
      if ((count || 0) > 0) return json({ error: `El asesor todavía tiene ${count} cliente(s). Reasígnalos antes de eliminarlo.` }, 409)

      const moves = await Promise.all([
        admin.from('clientes').update({ asesor_id: callerId }).eq('asesor_id', userId),
        admin.from('cotizaciones').update({ asesor_id: callerId }).eq('asesor_id', userId),
        admin.from('seguimientos').update({ asesor_id: callerId }).eq('asesor_id', userId),
      ])
      if (moves.some(r => r.error)) return json({ error: 'No se pudo reasignar el historial antes de eliminar al asesor.' }, 500)

      const { error } = await admin.auth.admin.deleteUser(userId)
      return error ? json({ error: error.message }, 400) : json({ message: 'Asesor eliminado correctamente.' })
    }

    return json({ error: 'Acción no reconocida.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
