import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('No autenticado.');

    const { data: callerProfile, error: callerError } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (callerError || callerProfile?.role !== 'admin') throw new Error('Solo un administrador puede invitar asesores.');

    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const fullName = String(body?.full_name || '').trim();
    if (!email || !fullName) throw new Error('Correo y nombre son obligatorios.');

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const redirectTo = Deno.env.get('AUTOSALE_APP_URL') || undefined;
    const inviteOptions: Record<string, unknown> = { data: { full_name: fullName } };
    if (redirectTo) inviteOptions.redirectTo = redirectTo;
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, inviteOptions);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, message: `Invitación enviada a ${email}.`, user_id: data.user?.id ?? null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Error inesperado' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
