import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405, headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Sesión requerida.' }, 401)

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Sesión inválida.' }, 401)

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role,active')
      .eq('id', userData.user.id)
      .single()

    if (profileError || profile?.role !== 'admin' || profile?.active !== true) {
      return json({ error: 'Solo un administrador puede crear asesores.' }, 403)
    }

    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    const fullName = String(body?.full_name || '').trim()
    const password = String(body?.password || '')

    if (!email || !fullName || password.length < 8) {
      return json({ error: 'Nombre, correo y contraseña de al menos 8 caracteres son obligatorios.' }, 400)
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (error) return json({ error: error.message }, 400)

    await admin.from('profiles').update({ full_name: fullName, role: 'asesor', active: true }).eq('id', data.user.id)
    return json({ message: 'Asesor creado correctamente.', user_id: data.user.id })
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
