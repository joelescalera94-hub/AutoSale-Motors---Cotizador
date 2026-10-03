/* ================================================================
   AUTOSALE MOTORS · COTIZADOR + CRM · APP ESTABLE
   ================================================================ */
(() => {
  'use strict';

  const cfg = window.AUTOSALE_SUPABASE || {};
  const SUPABASE_URL = String(cfg.url || '').replace(/\/$/, '');
  const SUPABASE_KEY = String(cfg.anonKey || '');
  const hasSupabase = Boolean(window.supabase?.createClient && SUPABASE_URL && SUPABASE_KEY);
  const db = hasSupabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, experimental: { passkey: true } }
  }) : null;

  const LOCAL_VEHICLES_KEY = 'autosale_vehiculos_v2_cache';
  const SETTINGS_KEY = 'autosale_settings_v1';
  const RATE_DEFAULT = 16;
  const CREDIT_SURCHARGE_USD = 1000;
  const DESGRAVAMEN_DEFAULT = 0.083; // % mensual sobre saldo deudor
  const VEHICLE_INSURANCE_DEFAULT = 700; // Bs/mes
  const PROPERTY_INSURANCE_DEFAULT = 150; // Bs/mes

  let session = null;
  let profile = null;
  let vehicles = [];
  let clients = []; // cartera personal del usuario actual (admin incluido)
  let advisors = [];
  let followups = []; // seguimientos personales
  let quotesSummary = []; // cotizaciones personales
  let adminTeamClients = [];
  let adminTeamFollowups = [];
  let adminTeamQuotes = [];
  let selectedClientId = '';
  let historyClientId = '';
  let selectedEditingQuoteId = '';
  let selectedVehicle = null;
  let vehicleCandidateId = '';
  let quoteTabs = [];
  let activeQuoteKey = '';
  let initialPct = 0;
  let financeMode = 'initial';
  let financeSourceCurrency = 'usd';
  let priceBsModeQuote = 'tipo_cambio';
  let realtimeChannel = null;
  let settings = {
    tipo_cambio: 6.96,
    seguro_desgravamen: DESGRAVAMEN_DEFAULT,
    seguro_vehicular_mensual: VEHICLE_INSURANCE_DEFAULT,
    seguro_inmueble_mensual: PROPERTY_INSURANCE_DEFAULT
  };
  let lastMonthlyUsd = 0;
  let lastMonthlyBs = 0;
  let lastFinancialMonthlyUsd = 0;
  let lastFinancialMonthlyBs = 0;
  let lastDesgravamenBs = 0;
  let lastVehicleInsuranceBs = 0;
  let lastPropertyInsuranceBs = 0;
  let lastTotalMonthlyBs = 0;
  let clientPage = 1;
  let followupPage = 1;
  let vehicleAdminPage = 1;
  let advisorDetailPage = 1;
  let catalogPage = 1;
  let advisorPage = 1;
  let historyQuotePage = 1;
  let historyFollowupPage = 1;
  let historyQuotes = [];
  let historyFollowups = [];
  let confirmResolver = null;
  let clientReturnToQuote = false;
  let advisorDetailId = '';
  const CLIENTS_PER_PAGE = 10;
  const FOLLOWUPS_PER_PAGE = 10;
  const VEHICLES_PER_PAGE = 12;
  const ADVISOR_CLIENTS_PER_PAGE = 10;
  const CATALOG_PER_PAGE = 12;
  const ADVISORS_PER_PAGE = 10;
  const HISTORY_PER_PAGE = 10;
  const QUOTE_DRAFT_KEY = 'autosale_quote_draft';
  const CLIENT_DRAFT_KEY = 'autosale_client_draft';
  const userDraftKey = (base) => `${base}:${session?.user?.id || 'anonymous'}`;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  function showToast(message, type = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add('toast--visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('toast--visible'), 2800);
  }

  function setBusy(button, busy, busyText = 'Guardando…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = busyText;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function isGmail(email) { return /^[^\s@]+@gmail\.com$/i.test(String(email || '').trim()); }
  function isPin(value) { return /^\d{4}$/.test(String(value || '')); }
  function pinPassword(email, pin) { return `AutoSale-PIN:${String(email || '').trim().toLowerCase()}:${String(pin || '')}:2026`; }

  const PIN_GUARD_KEY = 'autosale_pin_guard';
  const PIN_MAX_ATTEMPTS = 5;
  const PIN_LOCK_MS = 5 * 60 * 1000;
  function readPinGuard() { try { return JSON.parse(localStorage.getItem(PIN_GUARD_KEY) || '{}'); } catch (_) { return {}; } }
  function writePinGuard(value) { try { localStorage.setItem(PIN_GUARD_KEY, JSON.stringify(value)); } catch (_) {} }
  function pinGuardFor(email) { const all=readPinGuard(); return all[String(email||'').trim().toLowerCase()] || { attempts:0, lockedUntil:0 }; }
  function pinLockRemaining(email) { const g=pinGuardFor(email); return Math.max(0, Number(g.lockedUntil||0)-Date.now()); }
  function recordPinFailure(email) {
    const key=String(email||'').trim().toLowerCase(), all=readPinGuard(), g=all[key]||{attempts:0,lockedUntil:0};
    if (Number(g.lockedUntil||0) > Date.now()) return;
    g.attempts=Number(g.attempts||0)+1;
    if(g.attempts>=PIN_MAX_ATTEMPTS){g.lockedUntil=Date.now()+PIN_LOCK_MS;g.attempts=0;}
    all[key]=g; writePinGuard(all);
  }
  function clearPinGuard(email) { const key=String(email||'').trim().toLowerCase(), all=readPinGuard(); delete all[key]; writePinGuard(all); }

  function showSplash() {
    const splash = $('#splashView');
    if (splash) { splash.hidden = false; splash.inert = false; }
    safeHideView($('#authView')); safeHideView($('#appView'));
  }

  function hideSplash() { safeHideView($('#splashView')); }

  function syncCredentialInput(selectId, inputId, labelId) {
    const type = $(`#${selectId}`)?.value || 'password';
    const input = $(`#${inputId}`), label = $(`#${labelId}`);
    if (!input || !label) return;
    const pin = type === 'pin';
    label.textContent = pin ? 'PIN de 4 dígitos' : 'Contraseña';
    input.value = '';
    input.inputMode = pin ? 'numeric' : 'text';
    input.maxLength = pin ? 4 : 128;
    input.minLength = pin ? 4 : 8;
    input.pattern = pin ? '\\d{4}' : '';
    input.placeholder = pin ? '0000' : 'Mínimo 8 caracteres';
  }

  function askConfirm({ title='Confirmar acción', message='', confirmText='Confirmar', danger=true } = {}) {
    const modal = $('#confirmModal');
    if (!modal) return Promise.resolve(false);
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    const accept = $('#confirmAcceptBtn');
    accept.textContent = confirmText;
    accept.className = danger ? 'danger-button' : 'modal__primary';
    openModal('confirmModal');
    return new Promise(resolve => { confirmResolver = resolve; });
  }

  function resolveConfirm(value) {
    if (!confirmResolver) return;
    const resolve = confirmResolver; confirmResolver = null;
    closeModal('confirmModal'); resolve(Boolean(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function normalizeText(value) {
    return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function moneyUSD(value) { return '$ ' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function moneyBs(value) { return 'Bs ' + Math.round(Number(value || 0)).toLocaleString('es-BO'); }
  function quoteStatusLabel(value) {
    return ({en_seguimiento:'En seguimiento',esperando_credito:'Esperando crédito',vendido:'Vendido',perdido:'Perdido'})[value] || value || '—';
  }
  function purchaseModeLabel(value) {
    return ({contado:'Contado',garante_personal:'Garante personal',hipotecario_vehicular:'Garantía vehicular',hipotecado_inmueble:'Garantía de inmueble'})[value] || 'Modo sin definir';
  }
  const CLIENT_ORIGINS = ['Concesionaria','Facebook','TikTok','Recomendación de un cliente anterior','Web'];
  const LOST_REASONS = ['Precio alto','Crédito rechazado','Permuta rechazada','Dejó de responder'];
  const FOLLOWUP_TYPES = ['Esperando visita','Esperando crédito','Esperando carpeta','Esperando cuota inicial','Esperando mensaje/llamada','Esperando permuta'];

  function localDateTimeParts(value) {
    if (!value) return { date: '', time: '' };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { date: '', time: '' };
    const pad = n => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  function combineLocalDateTime(date, time) {
    if (!date) return null;
    const d = new Date(`${date}T${time || '09:00'}:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  function formatDateTime(value) {
    if (!value) return 'Sin fecha programada';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Sin fecha programada';
    return new Intl.DateTimeFormat('es-BO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(d).replace(',', ' ·');
  }
  function phoneKey(value) { return String(value || '').replace(/\D/g, ''); }
  function daysSince(value) {
    if (!value) return Infinity;
    const ms = Date.now() - new Date(value).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  }
  function lastActivityForClient(clientId) {
    const client = clients.find(c => c.id === clientId);
    const dates = [client?.updated_at || client?.created_at,
      ...followups.filter(f => f.cliente_id === clientId).map(f => f.updated_at || f.created_at),
      ...quotesSummary.filter(q => q.cliente_id === clientId).map(q => q.updated_at || q.created_at)
    ].filter(Boolean).map(v => new Date(v).getTime()).filter(Number.isFinite);
    return dates.length ? new Date(Math.max(...dates)).toISOString() : client?.created_at || null;
  }
  function latestPendingFollowup(clientId) {
    return followups.filter(f => f.cliente_id === clientId && f.estado === 'pendiente')
      .sort((a,b) => new Date(b.programado_para || b.created_at || 0) - new Date(a.programado_para || a.created_at || 0))[0] || null;
  }
  function followupTimingLabel(value) {
    if (!value) return { key:'sin_fecha', label:'Sin fecha', tone:'muted' };
    const d = new Date(value); const now = new Date();
    const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const diff = Math.round((start(d) - start(now)) / 86400000);
    if (diff < 0) return { key:'vencidos', label:'Vencidos', tone:'danger' };
    if (diff === 0) return { key:'hoy', label:'Hoy', tone:'today' };
    if (diff === 1) return { key:'manana', label:'Mañana', tone:'warning' };
    if (diff <= 7) return { key:'semana', label:'Esta semana', tone:'normal' };
    return { key:'adelante', label:'Más adelante', tone:'muted' };
  }
  function downloadCsv(filename, rows) {
    const esc = v => `"${String(v ?? '').replaceAll('"','""')}"`;
    const csv = '\ufeff' + rows.map(row => row.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500);
  }

  // --------------------------------------------------------------
  // Tema
  // --------------------------------------------------------------
  function initTheme() {
    const dark = localStorage.getItem('theme') !== 'light';
    if (dark) document.body.setAttribute('data-theme', 'dark'); else document.body.removeAttribute('data-theme');
    $('#themeBtn').textContent = dark ? '☀️' : '🌙';
  }
  function toggleTheme() {
    const dark = document.body.getAttribute('data-theme') === 'dark';
    if (dark) document.body.removeAttribute('data-theme'); else document.body.setAttribute('data-theme', 'dark');
    $('#themeBtn').textContent = dark ? '🌙' : '☀️';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
  }

  // --------------------------------------------------------------
  // Auth
  // --------------------------------------------------------------
  async function bootAuth() {
    showSplash();
    if (!db) {
      hideSplash(); safeShowView($('#authView'), 'grid');
      $('#loginMessage').textContent = 'Supabase no está configurado.';
      return;
    }
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      if (data.session) await setSession(data.session);
      else showLoggedOut();
    } catch (error) {
      console.warn('[AutoSale] sesión:', error);
      showLoggedOut('No se pudo verificar la sesión. Intenta nuevamente.');
    }
    db.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession) await setSession(newSession);
      else if (!$('#splashView') || $('#splashView').hidden) showLoggedOut();
    });
  }

  async function login(event) {
    event.preventDefault();
    if (!db) return $('#loginMessage').textContent = 'Supabase no está configurado.';
    const email=$('#loginEmail').value.trim().toLowerCase(), type=$('#loginCredentialType').value, secret=$('#loginPassword').value;
    if (!isGmail(email)) return $('#loginMessage').textContent='Usa una cuenta Gmail válida.';
    if (type==='pin' && !isPin(secret)) return $('#loginMessage').textContent='El PIN debe tener exactamente 4 dígitos.';
    const remaining=type==='pin'?pinLockRemaining(email):0;
    if(remaining>0) return $('#loginMessage').textContent=`Demasiados intentos. Prueba de nuevo en ${Math.ceil(remaining/60000)} min.`;
    const btn=$('#loginBtn'); setBusy(btn,true,'Ingresando…'); $('#loginMessage').textContent='';
    try {
      const password=type==='pin'?pinPassword(email,secret):secret;
      const {data,error}=await db.auth.signInWithPassword({email,password});
      if(error){if(type==='pin')recordPinFailure(email);throw error;}
      if(type==='pin')clearPinGuard(email);
      await setSession(data.session);
    } catch(error) { $('#loginMessage').textContent=error?.message||'No se pudo iniciar sesión.'; }
    finally { setBusy(btn,false); }
  }

  async function registerAdvisor(event) {
    event.preventDefault();
    const fullName = $('#registerName').value.trim();
    const email = $('#registerEmail').value.trim().toLowerCase();
    const type = $('#registerCredentialType').value;
    const secret = $('#registerSecret').value;
    if (!fullName) return $('#registerMessage').textContent = 'Escribe tu nombre.';
    if (!isGmail(email)) return $('#registerMessage').textContent = 'Usa una cuenta Gmail válida.';
    if (type === 'pin' && !isPin(secret)) return $('#registerMessage').textContent = 'El PIN debe tener exactamente 4 dígitos.';
    if (type === 'password' && secret.length < 8) return $('#registerMessage').textContent = 'La contraseña debe tener al menos 8 caracteres.';
    const btn = $('#registerBtn'); setBusy(btn, true, 'Creando cuenta…'); $('#registerMessage').textContent = 'Creando cuenta…';
    const password = type === 'pin' ? pinPassword(email, secret) : secret;
    try {
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { full_name: fullName, credential_type: type } } });
      if (error) throw error;
      if (data.session) await db.auth.signOut();
      $('#registerForm').reset(); syncCredentialInput('registerCredentialType','registerSecret','registerSecretLabel');
      $('#registerMessage').textContent = 'Cuenta creada. Espera la aprobación del administrador para ingresar.';
    } catch (error) {
      $('#registerMessage').textContent = error?.message || 'No se pudo crear la cuenta.';
    } finally { setBusy(btn, false); }
  }

  function switchAuth(mode) {
    const login = mode !== 'register';
    $('#loginForm').hidden = !login; $('#registerForm').hidden = login;
    $('#showLoginBtn').classList.toggle('auth-switch__btn--active', login);
    $('#showRegisterBtn').classList.toggle('auth-switch__btn--active', !login);
    $('#showLoginBtn').setAttribute('aria-selected', String(login));
    $('#showRegisterBtn').setAttribute('aria-selected', String(!login));
    (login ? $('#loginEmail') : $('#registerName'))?.focus();
  }

  async function loginWithPasskey() {
    if (!window.PublicKeyCredential || !db?.auth?.signInWithPasskey) return showToast('Este navegador no admite acceso rápido.', 'error');
    const btn = $('#passkeyLoginBtn'); setBusy(btn, true, 'Esperando dispositivo…');
    $('#loginMessage').textContent = 'Confirma con huella, rostro o PIN del dispositivo…';
    try {
      const { data, error } = await db.auth.signInWithPasskey();
      if (error) throw error;
      if (data?.session) await setSession(data.session);
      $('#loginMessage').textContent = '';
    } catch (error) {
      const msg = String(error?.message || 'No se pudo usar el acceso rápido.');
      $('#loginMessage').textContent = msg.includes('passkey_disabled') ? 'Activa Passkeys en Supabase antes de usar acceso rápido.' : msg;
    } finally { setBusy(btn, false); }
  }

  function safeHideView(view) {
    if (!view) return;
    const active = document.activeElement;
    if (active && view.contains(active) && typeof active.blur === 'function') active.blur();
    view.inert = true;
    view.hidden = true;
    view.style.display = 'none';
    view.removeAttribute('aria-hidden');
  }

  function safeShowView(view, display = 'block') {
    if (!view) return;
    view.hidden = false;
    view.style.display = display;
    view.inert = false;
    view.removeAttribute('aria-hidden');
  }

  function setAuthUI(isLoggedIn) {
    const authView = $('#authView'), appView = $('#appView');
    hideSplash();
    document.body.classList.toggle('app-logged-in', isLoggedIn);
    if (isLoggedIn) { safeHideView(authView); safeShowView(appView, 'block'); }
    else { safeHideView(appView); safeShowView(authView, 'grid'); }
  }

  async function setSession(nextSession) {
    session = nextSession;
    if (!session?.user) return showLoggedOut();
    const { data, error } = await db.from('profiles').select('id,full_name,role,active,must_change_password,approval_status,credential_type').eq('id', session.user.id).single();
    if (error) { await db.auth.signOut(); return showLoggedOut('No se pudo cargar tu perfil.'); }
    if (data.approval_status && data.approval_status !== 'approved') {
      const message = data.approval_status === 'rejected' ? 'Tu solicitud fue rechazada. Contacta al administrador.' : 'Tu cuenta está pendiente de aprobación por el administrador.';
      await db.auth.signOut(); return showLoggedOut(message);
    }
    if (!data.active) { await db.auth.signOut(); return showLoggedOut('Tu cuenta está desactivada.'); }
    profile = data; setAuthUI(true);
    $('#currentUserName').textContent = data.full_name || session.user.email;
    $('#currentUserRole').textContent = data.role === 'admin' ? 'Administrador' : 'Asesor';
    $$('.app-tab--admin').forEach(tab => { tab.hidden = data.role !== 'admin'; });
    hydrateAccountView();
    await loadAllData(); initRealtime();
    if (data.must_change_password) openModal('passwordChangeModal');
  }

  function showLoggedOut(message = '') {
    session = null; profile = null;
    if (realtimeChannel) { db?.removeChannel(realtimeChannel); realtimeChannel = null; }
    closeModal('passwordChangeModal'); closeModal('quickAccessModal');
    setAuthUI(false);
    if (message) $('#loginMessage').textContent = message;
  }

  async function logout() { await db.auth.signOut(); }

  async function completeTemporaryPassword(event) {
    event.preventDefault();
    const password = $('#newPassword').value;
    const confirmPassword = $('#confirmPassword').value;
    if (password.length < 8) return showToast('La contraseña debe tener al menos 8 caracteres.', 'error');
    if (password !== confirmPassword) return showToast('Las contraseñas no coinciden.', 'error');
    const { error } = await db.auth.updateUser({ password });
    if (error) return showToast(error.message, 'error');
    const { error: fnError } = await db.functions.invoke('admin-user', { body: { action: 'complete-password-change' } });
    if (fnError) return showToast('La contraseña cambió, pero no se pudo cerrar el cambio temporal. Vuelve a iniciar sesión.', 'error');
    profile.must_change_password = false;
    closeModal('passwordChangeModal');
    $('#passwordChangeForm').reset();
    showToast('Contraseña actualizada.');
    if (window.PublicKeyCredential) openQuickAccessModal();
  }

  async function openQuickAccessModal() {
    if (!session) return;
    openModal('quickAccessModal');
    await renderPasskeys();
  }

  async function renderPasskeys() {
    const box = $('#passkeyList');
    if (!box) return;
    if (!window.PublicKeyCredential || !db?.auth?.passkey?.list) {
      box.innerHTML = '<div class="empty-state">Este navegador no admite passkeys.</div>';
      return;
    }
    const { data, error } = await db.auth.passkey.list();
    if (error) {
      box.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
      return;
    }
    const rows = Array.isArray(data) ? data : (data?.passkeys || []);
    box.innerHTML = rows.length ? rows.map(p => `<div class="simple-list__row"><div><strong>${escapeHtml(p.friendly_name || 'Acceso rápido')}</strong><span>Registrado ${formatDateTime(p.created_at)}</span></div><span>Activo</span></div>`).join('') : '<div class="empty-state">Aún no activaste huella o PIN en este dispositivo.</div>';
    const accountBox=$('#accountPasskeyList'); if(accountBox && accountBox!==box) accountBox.innerHTML=box.innerHTML;
  }

  async function registerPasskey() {
    if (!window.PublicKeyCredential || !db?.auth?.registerPasskey) return showToast('Este navegador no admite huella/PIN con passkeys.', 'error');
    const btn = $('#registerPasskeyBtn'); btn.disabled = true;
    try {
      const { error } = await db.auth.registerPasskey();
      if (error) throw error;
      await renderPasskeys();
      showToast('Acceso rápido activado.');
    } catch (error) {
      const msg = String(error?.message || 'No se pudo activar el acceso rápido.');
      showToast(msg.includes('passkey_disabled') ? 'Primero activa Passkeys en Supabase → Authentication → Passkeys.' : msg, 'error');
    } finally { btn.disabled = false; }
  }

  function hydrateAccountView() {
    if (!session?.user || !profile) return;
    if ($('#accountName')) $('#accountName').value = profile.full_name || '';
    if ($('#accountEmail')) $('#accountEmail').value = session.user.email || '';
    if ($('#accountCredentialType')) $('#accountCredentialType').value = profile.credential_type || 'password';
    syncCredentialInput('accountCredentialType','accountSecret','accountSecretLabel');
    renderAccountPasskeys();
  }

  async function saveAccountProfile(event) {
    event.preventDefault(); const name = $('#accountName').value.trim();
    if (!name) return showToast('Escribe tu nombre.', 'error');
    const btn = $('#saveAccountNameBtn'); setBusy(btn,true);
    try {
      const { error } = await db.rpc('update_my_profile', { new_name: name, new_credential_type: profile.credential_type || 'password' });
      if (error) throw error; profile.full_name = name; $('#currentUserName').textContent = name; showToast('Nombre actualizado.');
    } catch (error) { showToast(error.message || 'No se pudo actualizar el nombre.', 'error'); }
    finally { setBusy(btn,false); }
  }

  async function saveAccountCredential(event) {
    event.preventDefault();
    const type = $('#accountCredentialType').value, secret = $('#accountSecret').value;
    if (type === 'pin' && !isPin(secret)) return showToast('El PIN debe tener exactamente 4 dígitos.', 'error');
    if (type === 'password' && secret.length < 8) return showToast('La contraseña debe tener al menos 8 caracteres.', 'error');
    const btn = $('#saveAccountCredentialBtn'); setBusy(btn,true,'Actualizando…');
    try {
      const password = type === 'pin' ? pinPassword(session.user.email, secret) : secret;
      const { error } = await db.auth.updateUser({ password, data: { credential_type: type } }); if (error) throw error;
      const { error: profileError } = await db.rpc('update_my_profile', { new_name: profile.full_name || '', new_credential_type: type }); if (profileError) throw profileError;
      profile.credential_type = type; $('#accountSecret').value=''; showToast(type==='pin'?'PIN actualizado.':'Contraseña actualizada.');
    } catch (error) { showToast(error.message || 'No se pudo actualizar el acceso.', 'error'); }
    finally { setBusy(btn,false); }
  }

  async function renderAccountPasskeys() {
    const target = $('#accountPasskeyList'); if (!target) return;
    const source = $('#passkeyList');
    await renderPasskeys();
    if (source) target.innerHTML = source.innerHTML;
  }

  // --------------------------------------------------------------
  // Datos base
  // --------------------------------------------------------------
  async function loadSettings() {
    if (!db) return;
    const { data, error } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (error) console.warn('[Autosale] configuración:', error.message);
    if (data) settings = { ...settings, ...data };
    $('#tc').value = settings.tipo_cambio || 6.96;
    $('#tasa').value = RATE_DEFAULT;
    updateChipGroup('chips-tasa', Number($('#tasa').value || 16), 'val');
    updateChipGroup('chips-anios', Number($('#anios').value || 5), 'val');
    updateChipGroup('chips-pct-inicial', Number(initialPct ?? 0), 'pct');
  }

  async function loadVehicles() {
    if (!db) return;
    const { data, error } = await db.from('vehiculos').select('*').order('nombre');
    if (error) { console.error('[Autosale] vehículos:', error); return; }
    vehicles = data || [];
    try { localStorage.setItem(LOCAL_VEHICLES_KEY, JSON.stringify(vehicles)); } catch (_) {}
    renderVehicleSearch(); renderVehicleAdmin(); renderCatalogAdmin(); populateVehicleSelects(); updateQuoteTabsAfterVehicleSync(); renderGlobalSearch();
  }

  async function loadClients() {
    if (!db || !session) return;
    // La zona personal del administrador se comporta igual que la de un asesor.
    const { data, error } = await db.from('clientes')
      .select('*, vehiculo:vehiculos(id,nombre), permuta:cliente_permutas(id,estado_revision,marca,modelo,anio,placa,motor,combustible,valor_estimado)')
      .is('archived_at', null)
      .eq('asesor_id', session.user.id)
      .order('updated_at', { ascending: false });
    if (error) { console.error('[Autosale] clientes:', error); return; }
    clients = data || [];
    renderClients(); renderClientSelect(); populateFollowupClients(); renderGlobalSearch();
  }

  async function loadAdvisors() {
    if (profile?.role !== 'admin') { advisors = []; return; }
    const { data, error } = await db.from('profiles').select('id,full_name,role,active,created_at,must_change_password,approval_status,credential_type').eq('role', 'asesor').order('full_name');
    if (error) console.warn('[Autosale] asesores:', error.message);
    advisors = data || [];
    renderAdvisors(); populateAdvisorSelect(); populateReassignSelects();
  }

  async function loadFollowups() {
    if (!db || !session) return;
    const { data, error } = await db.from('seguimientos')
      .select('*, cliente:clientes(id,nombre_completo,celular,estado), asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)')
      .is('deleted_at', null)
      .eq('asesor_id', session.user.id)
      .order('programado_para', { ascending: true, nullsFirst: false });
    if (error) { console.warn('[Autosale] seguimientos:', error.message); followups = []; return; }
    followups = data || [];
    renderFollowups(); renderClients();
  }

  async function loadQuotesSummary() {
    if (!db || !session) return;
    const { data, error } = await db.from('cotizaciones')
      .select('id,numero,cliente_id,asesor_id,vehiculo_id,vehiculo_nombre,precio_usd,precio_bs,cuota_inicial_usd,cuota_inicial_bs,monto_financiado_usd,monto_financiado_bs,tasa_interes,seguro_desgravamen,plazo_anios,cuota_mensual_usd,cuota_mensual_bs,modalidad_compra,desgravamen_estimado_bs,seguro_vehicular_bs,seguro_inmueble_bs,cuota_financiera_bs,cuota_total_bs,created_at,updated_at')
      .is('deleted_at', null)
      .eq('asesor_id', session.user.id)
      .order('updated_at', { ascending: false });
    if (error) { console.warn('[Autosale] cotizaciones:', error.message); quotesSummary = []; return; }
    quotesSummary = data || [];
    renderClients(); renderGlobalSearch();
  }

  async function loadAdminTeamData() {
    if (!db || profile?.role !== 'admin') {
      adminTeamClients = []; adminTeamFollowups = []; adminTeamQuotes = [];
      return;
    }
    const [c, f, q] = await Promise.all([
      db.from('clientes').select('*, vehiculo:vehiculos(id,nombre), permuta:cliente_permutas(id,estado_revision,marca,modelo,anio,placa,motor,combustible,valor_estimado)').is('archived_at', null).order('updated_at',{ascending:false}),
      db.from('seguimientos').select('*, cliente:clientes(id,nombre_completo,celular,estado,asesor_id), asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)').is('deleted_at', null).order('programado_para',{ascending:true,nullsFirst:false}),
      db.from('cotizaciones').select('id,numero,cliente_id,asesor_id,vehiculo_id,vehiculo_nombre,precio_usd,precio_bs,cuota_inicial_usd,cuota_inicial_bs,monto_financiado_usd,monto_financiado_bs,tasa_interes,plazo_anios,cuota_mensual_usd,cuota_mensual_bs,modalidad_compra,seguro_vehicular_bs,cuota_total_bs,created_at,updated_at').is('deleted_at', null).order('updated_at',{ascending:false})
    ]);
    if (c.error) console.warn('[Autosale] clientes admin:', c.error.message);
    if (f.error) console.warn('[Autosale] seguimientos admin:', f.error.message);
    if (q.error) console.warn('[Autosale] cotizaciones admin:', q.error.message);
    adminTeamClients = c.data || [];
    adminTeamFollowups = f.data || [];
    adminTeamQuotes = q.data || [];
    renderDashboard();
    if (advisorDetailId && !$('#advisorDetailModal')?.hidden) renderAdvisorDetail(advisorDetailId);
  }

  async function loadAllData() {
    await loadSettings();
    await loadVehicles();
    await loadAdvisors();
    await Promise.all([loadClients(), loadFollowups(), loadQuotesSummary()]);
    if (profile?.role === 'admin') await loadAdminTeamData();
    renderDashboard();
    restoreQuoteDraft();
  }

  async function refreshCentralSettings() {
    if (!db || !session) return;
    const { data, error } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return;
    settings = { ...settings, ...data };
    $('#tc').value = settings.tipo_cambio || 6.96;
    if (priceBsModeQuote !== 'manual') $('#precioBs').value = Number($('#precio').value || 0) ? Math.round(Number($('#precio').value) * currentTc()) : '';
    if (financeMode === 'initial') syncCurrencyPair(financeSourceCurrency === 'usd' ? '#inicial' : '#inicialBs', financeSourceCurrency === 'usd' ? '#inicialBs' : '#inicial', financeSourceCurrency);
    if (financeMode === 'amount') syncCurrencyPair(financeSourceCurrency === 'usd' ? '#monto' : '#montoBs', financeSourceCurrency === 'usd' ? '#montoBs' : '#monto', financeSourceCurrency);
    recomputeFinanceForPriceChange();
    renderDashboard();
  }

  function initRealtime() {
    if (realtimeChannel || !db || !session) return;
    let timer;
    const refreshCrm = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await Promise.all([loadClients(), loadFollowups(), loadQuotesSummary()]);
        if (profile?.role === 'admin') await loadAdminTeamData();
      }, 250);
    };
    realtimeChannel = db.channel(`autosale-live-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehiculos' }, async () => { await loadVehicles(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, refreshCrm)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seguimientos' }, refreshCrm)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cotizaciones' }, refreshCrm)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, refreshCentralSettings)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async (payload) => {
        if (payload?.new?.id === session?.user?.id && payload.new.active === false) {
          showToast('Tu cuenta fue desactivada por el administrador.', 'error');
          await db.auth.signOut();
          return;
        }
        if (profile?.role === 'admin') await loadAdvisors();
      })
      .subscribe();
  }

  // --------------------------------------------------------------
  // Navegación
  // --------------------------------------------------------------
  function syncGlobalSearchVisibility(viewId) {
    const wrap = $('#globalSearchWrap');
    if (!wrap) return;
    wrap.hidden = viewId !== 'cotizadorView';
    if (wrap.hidden) $('#globalSearchResults').hidden = true;
  }

  function initTabs() {
    $$('.app-tab').forEach((tab) => tab.addEventListener('click', async () => {
      const viewId = tab.dataset.view;
      $$('.app-tab').forEach((item) => item.classList.toggle('app-tab--active', item === tab));
      $$('.app-view').forEach((view) => view.classList.toggle('app-view--active', view.id === viewId));
      syncGlobalSearchVisibility(viewId);
      if (viewId === 'adminView' && profile?.role === 'admin') await loadAdminTeamData();
      window.scrollTo({ top:0, behavior:'smooth' });
    }));
    syncGlobalSearchVisibility('cotizadorView');
  }

  function navigateToView(viewId) {
    $$('.app-tab').forEach(item => item.classList.toggle('app-tab--active', item.dataset.view === viewId));
    $$('.app-view').forEach(view => view.classList.toggle('app-view--active', view.id === viewId));
    syncGlobalSearchVisibility(viewId);
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal || modal.id === 'passwordChangeModal' && profile?.must_change_password) return;
    const active = document.activeElement;
    if (active && modal.contains(active) && typeof active.blur === 'function') active.blur();
    modal.hidden = true;
    modal.inert = true;
    if (!$$('.modal:not([hidden])').length) document.body.classList.remove('modal-open');
  }
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    modal.inert = false;
    document.body.classList.add('modal-open');
    const focusable = modal.querySelector('input:not([type="hidden"]),select,textarea,button:not([data-close])');
    setTimeout(() => focusable?.focus({preventScroll:true}), 20);
  }

  // --------------------------------------------------------------
  // Vehículos / cotizador
  // --------------------------------------------------------------
  function vehicleBsPrice(v) {
    const tc = Number($('#tc')?.value || settings.tipo_cambio || 0);
    if (v?.precio_bs_modo === 'manual' && Number(v.precio_bs_manual) > 0) return Number(v.precio_bs_manual);
    return Number(v?.precio || 0) * tc;
  }

  function quotePriceForMode(cashPriceUsd, mode) {
    const cash = Math.max(0, Number(cashPriceUsd || 0));
    return mode === 'contado' ? cash : cash + CREDIT_SURCHARGE_USD;
  }

  function listPriceForState(state = {}) {
    const vehicle = vehicles.find(v => String(v.id) === String(state.vehicleId || selectedVehicle?.id || ''));
    if (vehicle) return Number(vehicle.precio || 0);
    const stored = Number(state.listPriceUsd || 0);
    if (stored > 0) return stored;
    const current = Number(state.priceUsd || $('#precio')?.value || 0);
    return (state.purchaseMode || quoteMode()) === 'contado' ? current : Math.max(0, current - CREDIT_SURCHARGE_USD);
  }

  function repriceStateForMode(state, mode) {
    const next = { ...state, purchaseMode: mode || 'contado' };
    if (!next.vehicleId) return next;
    const listPriceUsd = listPriceForState(next);
    const priceUsd = quotePriceForMode(listPriceUsd, next.purchaseMode);
    const priceBs = Math.round(priceUsd * currentTc());
    next.listPriceUsd = listPriceUsd;
    next.priceUsd = priceUsd;
    next.priceBs = priceBs;
    next.priceBsModeQuote = 'tipo_cambio';

    if (next.financeMode === 'percent' && next.initialPct != null) {
      const pct = clamp(next.initialPct, 0, 100);
      next.initialUsd = Math.round(priceUsd * pct / 100);
      next.initialBs = Math.round(priceBs * pct / 100);
      next.amountUsd = Math.max(0, Math.round(priceUsd - next.initialUsd));
      next.amountBs = Math.max(0, Math.round(priceBs - next.initialBs));
    } else if (next.financeMode === 'amount') {
      next.amountUsd = Number(next.amountUsd || 0);
      next.amountBs = Number(next.amountBs || 0);
      next.initialUsd = Math.max(0, Math.round(priceUsd - next.amountUsd));
      next.initialBs = Math.max(0, Math.round(priceBs - next.amountBs));
    } else {
      next.initialUsd = Number(next.initialUsd || 0);
      next.initialBs = Number(next.initialBs || 0);
      next.amountUsd = Math.max(0, Math.round(priceUsd - next.initialUsd));
      next.amountBs = Math.max(0, Math.round(priceBs - next.initialBs));
    }
    return next;
  }

  function renderVehicleSearch() {
    const input = $('#buscarVehiculo');
    const container = $('#resultadosVehiculos');
    if (!input || !container) return;
    const q = normalizeText(input.value.trim());
    $('#limpiarVehiculo')?.classList.toggle('vehicle-search__clear--visible', Boolean(input.value));
    if (document.activeElement !== input || !q) {
      container.innerHTML = '';
      container.classList.remove('vehicle-search__results--visible');
      return;
    }
    const results = vehicles.filter(v => normalizeText(v.nombre).includes(q)).slice(0, 12);
    container.innerHTML = results.length ? results.map(v => `<button type="button" class="vehicle-search__result" data-id="${escapeHtml(v.id)}" role="option"><span class="vehicle-search__result-name">${escapeHtml(v.nombre)}</span><span class="vehicle-search__result-price">${moneyUSD(v.precio)}</span></button>`).join('') : '<div class="vehicle-search__empty">No se encontraron vehículos.</div>';
    container.classList.add('vehicle-search__results--visible');
  }

  function chooseVehicleCandidate(id) {
    const vehicle = vehicles.find(v => String(v.id) === String(id));
    if (!vehicle) return;
    vehicleCandidateId = vehicle.id;
    $('#buscarVehiculo').value = vehicle.nombre;
    $('#addVehicleQuoteBtn').disabled = false;
    $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible');
    $('#limpiarVehiculo')?.classList.add('vehicle-search__clear--visible');
  }

  function clearVehicleSearch() {
    vehicleCandidateId = '';
    $('#buscarVehiculo').value = '';
    $('#addVehicleQuoteBtn').disabled = true;
    $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible');
    $('#limpiarVehiculo')?.classList.remove('vehicle-search__clear--visible');
  }

  function currentTc() { return Number($('#tc').value || settings.tipo_cambio || 0); }
  function effectivePriceBs() { return priceBsModeQuote === 'manual' ? Number($('#precioBs').value || 0) : Number($('#precio').value || 0) * currentTc(); }
  function clamp(value, min, max) { return Math.min(Math.max(Number(value || 0), min), max); }

  function quoteMode() { return $('#quotePurchaseMode')?.value || 'contado'; }

  function quoteStateFromUI() {
    const tabState = quoteTabs.find(t => t.key === activeQuoteKey) || {};
    return {
      vehicleId: selectedVehicle?.id || tabState.vehicleId || null,
      vehicleName: selectedVehicle?.nombre || tabState.vehicleName || $('#buscarVehiculo').value.trim(),
      listPriceUsd: listPriceForState(tabState),
      priceUsd: Number($('#precio').value || 0),
      priceBs: Number($('#precioBs').value || effectivePriceBs() || 0),
      initialUsd: Number($('#inicial').value || 0),
      initialBs: Number($('#inicialBs').value || 0),
      amountUsd: Number($('#monto').value || 0),
      amountBs: Number($('#montoBs').value || 0),
      rate: Number($('#tasa').value || 0),
      years: Number($('#anios').value || 0),
      initialPct,
      financeMode,
      financeSourceCurrency,
      priceBsModeQuote,
      purchaseMode: quoteMode(),
      monthlyUsd: lastMonthlyUsd,
      monthlyBs: lastMonthlyBs,
      financialMonthlyUsd: lastFinancialMonthlyUsd,
      financialMonthlyBs: lastFinancialMonthlyBs,
      desgravamenBs: lastDesgravamenBs,
      vehicleInsuranceBs: lastVehicleInsuranceBs,
      propertyInsuranceBs: lastPropertyInsuranceBs,
      totalMonthlyBs: lastTotalMonthlyBs
    };
  }

  function syncActiveTabFromUI() {
    if (!activeQuoteKey) return;
    const idx = quoteTabs.findIndex(t => t.key === activeQuoteKey);
    if (idx < 0) return;
    quoteTabs[idx] = { ...quoteTabs[idx], ...quoteStateFromUI() };
  }

  function computeQuoteMetrics(state) {
    const mode = state.purchaseMode || 'contado';
    if (mode === 'contado') {
      return {
        financialMonthlyUsd: 0, financialMonthlyBs: 0,
        desgravamenUsd: 0, desgravamenBs: 0,
        propertyInsuranceUsd: 0, propertyInsuranceBs: 0,
        vehicleInsuranceBs: 0,
        monthlyUsd: Number(state.priceUsd || 0), monthlyBs: Number(state.priceBs || 0),
        totalMonthlyBs: Number(state.priceBs || 0)
      };
    }
    const n = Number(state.years || 0) * 12;
    const rate = Number(state.rate || 0);
    const i = rate >= 0 ? (rate / 100) / 12 : 0;
    const financialUsd = n > 0 ? payment(Number(state.amountUsd || 0), i, n) : 0;
    const financialBs = n > 0 ? payment(Number(state.amountBs || 0), i, n) : 0;
    const desRate = Number(settings.seguro_desgravamen ?? DESGRAVAMEN_DEFAULT) / 100;
    const desUsd = Number(state.amountUsd || 0) * desRate;
    const desBs = Number(state.amountBs || 0) * desRate;
    const propertyBs = mode === 'hipotecado_inmueble' ? Number(settings.seguro_inmueble_mensual ?? PROPERTY_INSURANCE_DEFAULT) : 0;
    const propertyUsd = currentTc() > 0 ? propertyBs / currentTc() : 0;
    const vehicleBs = mode === 'hipotecario_vehicular' ? Number(settings.seguro_vehicular_mensual ?? VEHICLE_INSURANCE_DEFAULT) : 0;
    const monthlyUsd = financialUsd + desUsd + propertyUsd;
    const monthlyBs = financialBs + desBs + propertyBs;
    return {
      financialMonthlyUsd: Math.round(financialUsd), financialMonthlyBs: Math.round(financialBs),
      desgravamenUsd: desUsd, desgravamenBs: Math.round(desBs),
      propertyInsuranceUsd: propertyUsd, propertyInsuranceBs: Math.round(propertyBs),
      vehicleInsuranceBs: Math.round(vehicleBs),
      monthlyUsd: Math.round(monthlyUsd), monthlyBs: Math.round(monthlyBs),
      totalMonthlyBs: Math.round(monthlyBs + vehicleBs)
    };
  }

  function refreshQuoteStateForCurrentTc(state) {
    if (!state) return state;
    const tc = currentTc();
    if (!tc || tc <= 0) return state;
    const next = { ...state };
    if (next.priceBsModeQuote !== 'manual' && Number(next.priceUsd || 0) > 0) {
      next.priceBs = Math.round(Number(next.priceUsd) * tc);
    }
    if (next.financeMode === 'percent' && next.initialPct != null) {
      const pct = clamp(next.initialPct, 0, 100);
      next.initialUsd = Math.round(Number(next.priceUsd || 0) * pct / 100);
      next.initialBs = Math.round(Number(next.priceBs || 0) * pct / 100);
      next.amountUsd = Math.max(0, Math.round(Number(next.priceUsd || 0) - next.initialUsd));
      next.amountBs = Math.max(0, Math.round(Number(next.priceBs || 0) - next.initialBs));
    } else if (next.financeSourceCurrency === 'bs') {
      next.initialUsd = next.initialBs ? Math.round(Number(next.initialBs) / tc) : 0;
      next.amountUsd = next.amountBs ? Math.round(Number(next.amountBs) / tc) : 0;
    } else {
      next.initialBs = next.initialUsd ? Math.round(Number(next.initialUsd) * tc) : 0;
      next.amountBs = next.amountUsd ? Math.round(Number(next.amountUsd) * tc) : 0;
    }
    return next;
  }

  function applyQuoteState(state) {
    state = refreshQuoteStateForCurrentTc(state);
    selectedVehicle = state.vehicleId ? vehicles.find(v => String(v.id) === String(state.vehicleId)) || { id: state.vehicleId, nombre: state.vehicleName } : null;
    $('#precio').value = state.priceUsd || '';
    $('#precioBs').value = state.priceBs || '';
    $('#inicial').value = state.initialUsd || '';
    $('#inicialBs').value = state.initialBs || '';
    $('#monto').value = state.amountUsd || '';
    $('#montoBs').value = state.amountBs || '';
    $('#tasa').value = Number.isFinite(Number(state.rate)) ? Number(state.rate) : RATE_DEFAULT;
    $('#anios').value = Number(state.years || 5);
    $('#quotePurchaseMode').value = state.purchaseMode || 'contado';
    initialPct = state.initialPct ?? null;
    financeMode = state.financeMode || 'initial';
    financeSourceCurrency = state.financeSourceCurrency || 'usd';
    priceBsModeQuote = state.priceBsModeQuote || 'tipo_cambio';
    updateChipGroup('chips-tasa', Number($('#tasa').value), 'val');
    updateChipGroup('chips-anios', Number($('#anios').value), 'val');
    updateInitialChipFromManual();
    syncFinancingVisibility();
    calc();
  }

  function baseStateForNewVehicle(vehicle) {
    const current = quoteStateFromUI();
    const purchaseMode = current.purchaseMode || clientPurchaseModeForQuote() || 'contado';
    const listPriceUsd = Number(vehicle.precio || 0);
    const priceUsd = quotePriceForMode(listPriceUsd, purchaseMode);
    const priceBs = Math.round(priceUsd * currentTc());
    let initialUsd = current.initialUsd || 0;
    let initialBs = current.initialBs || 0;
    let amountUsd = 0, amountBs = 0;
    let mode = current.financeMode || 'initial';
    let pct = current.initialPct;
    if (mode === 'percent' && pct != null) {
      initialUsd = Math.round(priceUsd * pct / 100);
      initialBs = Math.round(priceBs * pct / 100);
      amountUsd = Math.max(0, priceUsd - initialUsd);
      amountBs = Math.max(0, priceBs - initialBs);
    } else if (mode === 'amount') {
      amountUsd = current.amountUsd || 0;
      amountBs = current.amountBs || 0;
      initialUsd = Math.max(0, priceUsd - amountUsd);
      initialBs = Math.max(0, priceBs - amountBs);
    } else {
      mode = 'initial';
      amountUsd = Math.max(0, priceUsd - initialUsd);
      amountBs = Math.max(0, priceBs - initialBs);
    }
    return {
      key: String(vehicle.id), vehicleId: vehicle.id, vehicleName: vehicle.nombre,
      listPriceUsd, priceUsd, priceBs, initialUsd, initialBs, amountUsd, amountBs,
      rate: Number.isFinite(Number(current.rate)) ? Number(current.rate) : RATE_DEFAULT,
      years: Number(current.years) > 0 ? Number(current.years) : 5,
      initialPct: pct, financeMode: mode, financeSourceCurrency: current.financeSourceCurrency || 'usd',
      priceBsModeQuote: 'tipo_cambio', purchaseMode,
      existingQuoteId: '', quoteNumber: null
    };
  }

  function clientPurchaseModeForQuote() {
    return clients.find(c => c.id === selectedClientId)?.modo_compra || '';
  }

  function addVehicleToQuote(id = vehicleCandidateId) {
    const vehicle = vehicles.find(v => String(v.id) === String(id));
    if (!vehicle) return showToast('Selecciona un vehículo del buscador.', 'error');
    syncActiveTabFromUI();
    const existing = quoteTabs.find(t => String(t.vehicleId) === String(vehicle.id));
    if (existing) {
      activateQuoteTab(existing.key);
      clearVehicleSearch();
      return;
    }
    const state = baseStateForNewVehicle(vehicle);
    quoteTabs.push(state);
    activeQuoteKey = state.key;
    renderQuoteTabs();
    applyQuoteState(state);
    clearVehicleSearch();
    updateSaveQuoteLabel();
    persistQuoteDraft();
  }

  function activateQuoteTab(key) {
    if (activeQuoteKey === key) return;
    syncActiveTabFromUI();
    const state = quoteTabs.find(t => t.key === key);
    if (!state) return;
    activeQuoteKey = key;
    applyQuoteState(state);
    renderQuoteTabs();
    updateSaveQuoteLabel();
    persistQuoteDraft();
  }

  function removeQuoteTab(key) {
    syncActiveTabFromUI();
    const idx = quoteTabs.findIndex(t => t.key === key);
    if (idx < 0) return;
    quoteTabs.splice(idx, 1);
    if (activeQuoteKey === key) {
      const next = quoteTabs[idx] || quoteTabs[idx - 1] || null;
      activeQuoteKey = next?.key || '';
      if (next) applyQuoteState(next); else clearQuoteInputs(false);
    }
    renderQuoteTabs();
    updateSaveQuoteLabel();
    persistQuoteDraft();
  }

  function renderQuoteTabs() {
    const box = $('#quoteVehicleTabs');
    if (!box) return;
    box.innerHTML = quoteTabs.map(t => `<button type="button" class="quote-tab ${t.key===activeQuoteKey?'quote-tab--active':''}" data-quote-tab="${escapeHtml(t.key)}"><span>${escapeHtml(t.vehicleName || 'Vehículo')}</span><i data-remove-quote-tab="${escapeHtml(t.key)}" aria-label="Quitar ${escapeHtml(t.vehicleName || 'vehículo')}">×</i></button>`).join('');
  }

  function updateQuoteTabsAfterVehicleSync() {
    quoteTabs = quoteTabs.map(tab => {
      const v = vehicles.find(x => String(x.id) === String(tab.vehicleId));
      return v ? { ...tab, vehicleName: v.nombre } : tab;
    });
    if (activeQuoteKey) {
      const active = quoteTabs.find(t => t.key === activeQuoteKey);
      selectedVehicle = active?.vehicleId ? vehicles.find(v => String(v.id) === String(active.vehicleId)) || null : null;
    }
    renderQuoteTabs();
  }

  function clearSelectedVehicle() {
    if (activeQuoteKey) removeQuoteTab(activeQuoteKey);
    else clearVehicleSearch();
  }

  function syncCurrencyPair(sourceId, targetId, sourceCurrency) {
    const tc = currentTc();
    const source = Number($(sourceId).value || 0);
    if (!tc || tc <= 0) return;
    $(targetId).value = source ? Math.round(sourceCurrency === 'usd' ? source * tc : source / tc) : '';
  }

  function currentInitialPct() {
    const priceUsd = Number($('#precio').value || 0);
    const initialUsd = Number($('#inicial').value || 0);
    return priceUsd > 0 ? clamp(initialUsd / priceUsd * 100, 0, 100) : (initialPct ?? 0);
  }

  function updateInitialChipFromManual() {
    const pct = currentInitialPct();
    const values = [0,10,20,30,50];
    const exact = values.find(v => Math.abs(v - pct) < .11);
    updateChipGroup('chips-pct-inicial', exact ?? -1, 'pct');
  }

  function recomputeFinanceForPriceChange() {
    const priceUsd = Number($('#precio').value || 0);
    const priceBs = effectivePriceBs();
    if (financeMode === 'percent') { syncFinanceByPct(initialPct ?? 0, false); return; }
    if (financeMode === 'amount') {
      const amountUsd = Number($('#monto').value || 0), amountBs = Number($('#montoBs').value || 0);
      if (priceUsd > 0) $('#inicial').value = Math.max(0, Math.round(priceUsd - amountUsd)) || '';
      if (priceBs > 0) $('#inicialBs').value = Math.max(0, Math.round(priceBs - amountBs)) || '';
    } else {
      const initialUsd = Number($('#inicial').value || 0), initialBs = Number($('#inicialBs').value || 0);
      if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - initialUsd)) || '';
      if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - initialBs)) || '';
    }
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFinanceByPct(pct, persist = true) {
    const safePct = clamp(pct, 0, 100);
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    initialPct = safePct; financeMode = 'percent';
    $('#inicial').value = priceUsd > 0 ? Math.round(priceUsd * safePct / 100) || '' : $('#inicial').value;
    $('#inicialBs').value = priceBs > 0 ? Math.round(priceBs * safePct / 100) || '' : $('#inicialBs').value;
    if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - Number($('#inicial').value || 0))) || '';
    if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - Number($('#inicialBs').value || 0))) || '';
    updateChipGroup('chips-pct-inicial', safePct, 'pct'); calc(); if (persist) persistQuoteDraft();
  }

  function syncFromInitialUsd() {
    financeMode = 'initial'; financeSourceCurrency = 'usd'; initialPct = null;
    syncCurrencyPair('#inicial', '#inicialBs', 'usd');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - Number($('#inicial').value || 0))) || '';
    if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - Number($('#inicialBs').value || 0))) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFromInitialBs() {
    financeMode = 'initial'; financeSourceCurrency = 'bs'; initialPct = null;
    syncCurrencyPair('#inicialBs', '#inicial', 'bs');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - Number($('#inicial').value || 0))) || '';
    if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - Number($('#inicialBs').value || 0))) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFromAmountUsd() {
    financeMode = 'amount'; financeSourceCurrency = 'usd'; initialPct = null;
    syncCurrencyPair('#monto', '#montoBs', 'usd');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    if (priceUsd > 0) $('#inicial').value = Math.max(0, Math.round(priceUsd - Number($('#monto').value || 0))) || '';
    if (priceBs > 0) $('#inicialBs').value = Math.max(0, Math.round(priceBs - Number($('#montoBs').value || 0))) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFromAmountBs() {
    financeMode = 'amount'; financeSourceCurrency = 'bs'; initialPct = null;
    syncCurrencyPair('#montoBs', '#monto', 'bs');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    if (priceUsd > 0) $('#inicial').value = Math.max(0, Math.round(priceUsd - Number($('#monto').value || 0))) || '';
    if (priceBs > 0) $('#inicialBs').value = Math.max(0, Math.round(priceBs - Number($('#montoBs').value || 0))) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function updateFinanceFromPrice() {
    const price = Number($('#precio').value || 0);
    if (priceBsModeQuote !== 'manual') $('#precioBs').value = price ? Math.round(price * currentTc()) : '';
    recomputeFinanceForPriceChange();
  }

  function changeQuotePurchaseMode() {
    const mode = quoteMode();
    syncActiveTabFromUI();
    if (activeQuoteKey) {
      const idx = quoteTabs.findIndex(t => t.key === activeQuoteKey);
      if (idx >= 0) {
        quoteTabs[idx] = repriceStateForMode({ ...quoteTabs[idx], ...quoteStateFromUI() }, mode);
        applyQuoteState(quoteTabs[idx]);
        renderQuoteTabs();
      }
    } else {
      calc();
    }
    persistQuoteDraft();
  }

  function payment(principal, monthlyRate, periods) {
    const p = Number(principal || 0);
    if (p <= 0 || periods <= 0) return 0;
    if (monthlyRate <= 0) return p / periods;
    const pow = Math.pow(1 + monthlyRate, periods);
    return p * (monthlyRate * pow) / (pow - 1);
  }

  function syncFinancingVisibility() {
    const cash = quoteMode() === 'contado';
    $$('.financing-only').forEach(el => { el.hidden = cash; });
    $('#resultTitle').textContent = cash ? 'Precio al contado' : 'Cuota Mensual Estimada';
  }

  function calc() {
    syncFinancingVisibility();
    const state = quoteStateFromUI();
    const metrics = computeQuoteMetrics(state);
    lastFinancialMonthlyUsd = metrics.financialMonthlyUsd;
    lastFinancialMonthlyBs = metrics.financialMonthlyBs;
    lastDesgravamenBs = metrics.desgravamenBs;
    lastVehicleInsuranceBs = metrics.vehicleInsuranceBs;
    lastPropertyInsuranceBs = metrics.propertyInsuranceBs;
    lastMonthlyUsd = metrics.monthlyUsd;
    lastMonthlyBs = metrics.monthlyBs;
    lastTotalMonthlyBs = metrics.totalMonthlyBs;
    $('#resUSD').textContent = moneyUSD(lastMonthlyUsd);
    $('#resBOB').textContent = moneyBs(lastMonthlyBs);
    const showVehicleInsurance = quoteMode() === 'hipotecario_vehicular' && lastVehicleInsuranceBs > 0;
    $('#vehicleInsuranceResult').hidden = !showVehicleInsurance;
    if (showVehicleInsurance) {
      $('#vehicleInsuranceAmount').textContent = moneyBs(lastVehicleInsuranceBs);
      $('#totalMonthlyAmount').textContent = moneyBs(lastTotalMonthlyBs);
    }
    syncActiveTabFromUI();
  }

  function selectInitialPct(pct) { syncFinanceByPct(pct); }

  function updateChipGroup(id, value, attr) {
    document.querySelectorAll(`#${id} .cotizador__chip`).forEach((chip) => {
      chip.classList.toggle('cotizador__chip--active', Math.abs(Number(chip.dataset[attr === 'pct' ? 'pct' : 'val']) - Number(value)) < 0.11);
    });
  }

  function selectChip(inputId, value) {
    $(`#${inputId}`).value = value;
    updateChipGroup(`chips-${inputId}`, value, 'val');
    calc(); persistQuoteDraft();
  }

  function quoteDraftData() {
    syncActiveTabFromUI();
    return {
      clientId:selectedClientId,
      tabs:quoteTabs,
      activeQuoteKey,
      manual:quoteStateFromUI()
    };
  }
  function persistQuoteDraft() {
    if (!session) return;
    try { localStorage.setItem(userDraftKey(QUOTE_DRAFT_KEY), JSON.stringify(quoteDraftData())); } catch (_) {}
  }
  function restoreQuoteDraft() {
    if (!session) return;
    let d; try { d = JSON.parse(localStorage.getItem(userDraftKey(QUOTE_DRAFT_KEY)) || 'null'); } catch (_) { return; }
    if (!d) {
      updateChipGroup('chips-tasa', Number($('#tasa').value || RATE_DEFAULT), 'val');
      updateChipGroup('chips-anios', Number($('#anios').value || 5), 'val');
      updateChipGroup('chips-pct-inicial', 0, 'pct');
      return;
    }
    selectedClientId = clients.some(c=>c.id===d.clientId) ? d.clientId : '';
    $('#quoteClientSelect').value = selectedClientId;
    quoteTabs = Array.isArray(d.tabs) ? d.tabs.filter(t => t?.key) : [];
    activeQuoteKey = quoteTabs.some(t=>t.key===d.activeQuoteKey) ? d.activeQuoteKey : (quoteTabs[0]?.key || '');
    renderQuoteTabs();
    if (activeQuoteKey) applyQuoteState(quoteTabs.find(t=>t.key===activeQuoteKey));
    else if (d.manual) applyQuoteState(d.manual);
    updateSaveQuoteLabel();
  }

  function clearQuoteInputs(clearClient = true) {
    selectedEditingQuoteId = '';
    selectedVehicle = null;
    activeQuoteKey = '';
    initialPct = 0; financeMode = 'initial'; financeSourceCurrency = 'usd'; priceBsModeQuote = 'tipo_cambio';
    lastMonthlyUsd = lastMonthlyBs = lastTotalMonthlyBs = lastVehicleInsuranceBs = lastPropertyInsuranceBs = lastDesgravamenBs = 0;
    ['precio','precioBs','inicial','inicialBs','monto','montoBs'].forEach(id => { $(`#${id}`).value = ''; });
    $('#tasa').value = RATE_DEFAULT;
    $('#anios').value = 5;
    if (clearClient) { selectedClientId = ''; if ($('#quoteClientSelect')) $('#quoteClientSelect').value = ''; }
    $('#quotePurchaseMode').value = clientPurchaseModeForQuote() || 'contado';
    $('#quoteSaveStatus').textContent = '';
    updateChipGroup('chips-pct-inicial', 0, 'pct'); updateChipGroup('chips-tasa', Number($('#tasa').value), 'val'); updateChipGroup('chips-anios', 5, 'val');
    calc();
  }

  function resetQuote() {
    quoteTabs = [];
    clearVehicleSearch();
    clearQuoteInputs(true);
    renderQuoteTabs(); updateSaveQuoteLabel();
    try { localStorage.removeItem(userDraftKey(QUOTE_DRAFT_KEY)); } catch (_) {}
    showToast('Nueva cotización lista.');
  }

  function updateSaveQuoteLabel() {
    const btn = $('#saveQuoteBtn'); if (!btn) return;
    const count = quoteTabs.length || 1;
    if (quoteTabs.length > 1) btn.textContent = `Guardar ${quoteTabs.length} cotizaciones`;
    else if (quoteTabs[0]?.quoteNumber) btn.textContent = `Actualizar #${quoteTabs[0].quoteNumber}`;
    else if (selectedEditingQuoteId) btn.textContent = 'Actualizar cotización';
    else btn.textContent = 'Guardar cotización';
  }

  // --------------------------------------------------------------
  // Guardar / editar cotizaciones
  // --------------------------------------------------------------
  function quoteMessageBlock(state, index, total) {
    const m = computeQuoteMetrics(state);
    const tc = currentTc();
    let msg = total > 1 ? `*Cotización ${index + 1} de ${total}*\n` : '';
    if (state.vehicleName) msg += `🚘 *${state.vehicleName}*\n`;
    msg += `• Modalidad: ${purchaseModeLabel(state.purchaseMode)}\n`;
    msg += `• Tipo de cambio: Bs ${tc}\n`;
    if (state.priceUsd || state.priceBs) msg += `• Precio: ${moneyUSD(state.priceUsd)} (${moneyBs(state.priceBs)})\n`;
    if (state.purchaseMode !== 'contado') {
      msg += `• Cuota inicial: ${moneyUSD(state.initialUsd)} (${moneyBs(state.initialBs)})\n`;
      msg += `• Monto a financiar: ${moneyUSD(state.amountUsd)} (${moneyBs(state.amountBs)})\n`;
      msg += `• Tasa: ${state.rate}%\n`;
      msg += `• Plazo: ${state.years} años\n`;
      msg += `👉 *Cuota mensual estimada: ${moneyUSD(m.monthlyUsd)}* (${moneyBs(m.monthlyBs)}/mes)\n`;
      if (state.purchaseMode === 'hipotecario_vehicular' && m.vehicleInsuranceBs > 0) {
        msg += `• Seguro vehicular estimado: ${moneyBs(m.vehicleInsuranceBs)}/mes\n`;
        msg += `👉 *Total mensual estimado: ${moneyBs(m.totalMonthlyBs)}*\n`;
      }
    } else {
      msg += `👉 *Pago al contado: ${moneyUSD(state.priceUsd)}* (${moneyBs(state.priceBs)})\n`;
    }
    return msg.trim();
  }

  function buildQuoteMessage() {
    syncActiveTabFromUI();
    const states = quoteTabs.length ? quoteTabs : [quoteStateFromUI()];
    const useful = states.filter(s => Number(s.priceUsd || s.priceBs || s.amountUsd || s.amountBs) > 0 || s.vehicleName);
    if (!useful.length) return '';
    const client = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;
    let msg = `🚗 *AUTOSALE MOTORS - COTIZACIÓN*\n`;
    if (client?.nombre_completo) msg += `👤 Cliente: *${client.nombre_completo}*\n`;
    msg += `\n${useful.map((state, i) => quoteMessageBlock(state, i, useful.length)).join('\n\n────────────\n\n')}`;
    msg += `\n\n_Cotización referencial. Las condiciones finales dependen de la entidad financiera y aseguradora._`;
    return msg;
  }

  function whatsappPhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 8) digits = `591${digits}`;
    return digits;
  }

  async function shareQuote() {
    const msg = buildQuoteMessage();
    if (!msg) return showToast('Completa una cotización primero.', 'error');
    const client = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;
    const phone = whatsappPhone(client?.celular);
    const url = `https://wa.me/${phone || ''}?text=${encodeURIComponent(msg)}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      try {
        await navigator.clipboard.writeText(msg);
        showToast('WhatsApp fue bloqueado; copié las cotizaciones.');
      } catch (_) {
        showToast('No se pudo abrir WhatsApp.', 'error');
      }
    }
  }

  function quotePayloadFromState(state) {
    const metrics = computeQuoteMetrics(state);
    return {
      cliente_id: selectedClientId || null,
      asesor_id: session.user.id,
      vehiculo_id: state.vehicleId || null,
      vehiculo_nombre: state.vehicleName || '',
      precio_usd: Number(state.priceUsd || 0), precio_bs: Number(state.priceBs || 0),
      cuota_inicial_usd: Number(state.initialUsd || 0), cuota_inicial_bs: Number(state.initialBs || 0),
      monto_financiado_usd: Number(state.amountUsd || 0), monto_financiado_bs: Number(state.amountBs || 0),
      tasa_interes: Number(state.rate || 0), seguro_desgravamen: Number(settings.seguro_desgravamen || 0),
      plazo_anios: Number(state.years || 0), cuota_mensual_usd: metrics.monthlyUsd, cuota_mensual_bs: metrics.monthlyBs,
      modalidad_compra: state.purchaseMode || 'contado',
      desgravamen_estimado_bs: metrics.desgravamenBs,
      seguro_vehicular_bs: metrics.vehicleInsuranceBs,
      seguro_inmueble_bs: metrics.propertyInsuranceBs,
      cuota_financiera_bs: metrics.financialMonthlyBs,
      cuota_total_bs: metrics.totalMonthlyBs,
      notas: ''
    };
  }

  async function saveOneQuote(state) {
    const payload = quotePayloadFromState(state);
    if (payload.precio_usd <= 0 && payload.precio_bs <= 0 && payload.monto_financiado_usd <= 0 && payload.monto_financiado_bs <= 0) throw new Error('Ingresa un precio o un monto a financiar.');
    let existingId = state.existingQuoteId || '';
    if (!existingId && payload.cliente_id && payload.vehiculo_id) {
      const { data } = await db.from('cotizaciones').select('id,numero').eq('cliente_id', payload.cliente_id).eq('vehiculo_id', payload.vehiculo_id).is('deleted_at',null).order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if (data?.id) { existingId = data.id; state.quoteNumber = data.numero; }
    }
    let result;
    if (existingId) result = await db.from('cotizaciones').update(payload).eq('id', existingId).select('id,numero').single();
    else result = await db.from('cotizaciones').insert(payload).select('id,numero').single();
    if (result.error) throw result.error;
    state.existingQuoteId = result.data.id;
    state.quoteNumber = result.data.numero;
    return result.data;
  }

  async function saveQuote() {
    if (!db || !session) return;
    syncActiveTabFromUI();
    if (quoteTabs.length > 1 && !selectedClientId) return showToast('Selecciona un cliente para guardar varias cotizaciones.', 'error');
    const states = quoteTabs.length ? quoteTabs : [{ ...quoteStateFromUI(), existingQuoteId:selectedEditingQuoteId || '' }];
    const btn=$('#saveQuoteBtn'); setBusy(btn,true, states.length>1?'Guardando cotizaciones…':'Guardando…');
    try {
      const results=[]; for(const state of states) results.push(await saveOneQuote(state));
      selectedEditingQuoteId=quoteTabs.length?'':results[0]?.id||''; const count=results.length;
      $('#quoteSaveStatus').textContent=count>1?`${count} cotizaciones guardadas para el cliente`:`Cotización #${results[0].numero} guardada`;
      showToast(count>1?`${count} cotizaciones guardadas/actualizadas.`:`Cotización #${results[0].numero} guardada.`);
      updateSaveQuoteLabel(); persistQuoteDraft(); await loadQuotesSummary(); if(profile.role==='admin')await loadAdminTeamData();
    } catch(error){console.error(error);showToast(error.message||'No se pudo guardar la cotización.','error');}
    finally { setBusy(btn,false); updateSaveQuoteLabel(); }
  }

  async function loadQuoteForEdit(id) {
    let q = quotesSummary.find(item => String(item.id) === String(id)) || adminTeamQuotes.find(item => String(item.id) === String(id));
    if (!q) {
      const res = await db.from('cotizaciones').select('*').eq('id', id).single();
      if (res.error) return showToast(res.error.message, 'error');
      q = res.data;
    }
    // Solo puede editarse desde el espacio personal del dueño actual.
    if (q.asesor_id !== session.user.id) return showToast('Puedes revisar esta cotización desde Administración, pero solo el asesor asignado puede editarla.', 'error');
    selectedClientId = q.cliente_id || '';
    $('#quoteClientSelect').value = selectedClientId;
    quoteTabs = [];
    selectedEditingQuoteId = '';
    const state = {
      key:String(q.vehiculo_id || `manual-${q.id}`), vehicleId:q.vehiculo_id || null, vehicleName:q.vehiculo_nombre || '',
      priceUsd:Number(q.precio_usd||0), priceBs:Number(q.precio_bs||0), initialUsd:Number(q.cuota_inicial_usd||0), initialBs:Number(q.cuota_inicial_bs||0),
      amountUsd:Number(q.monto_financiado_usd||0), amountBs:Number(q.monto_financiado_bs||0), rate:Number(q.tasa_interes||RATE_DEFAULT), years:Number(q.plazo_anios||5),
      initialPct:null, financeMode:'initial', financeSourceCurrency:'usd', priceBsModeQuote:'manual', purchaseMode:q.modalidad_compra || clientPurchaseModeForQuote() || 'contado',
      existingQuoteId:q.id, quoteNumber:q.numero
    };
    if (q.vehiculo_id) { quoteTabs=[state]; activeQuoteKey=state.key; renderQuoteTabs(); applyQuoteState(state); }
    else { activeQuoteKey=''; selectedEditingQuoteId=q.id; applyQuoteState(state); }
    updateSaveQuoteLabel(); $('#quoteSaveStatus').textContent=`Editando cotización #${q.numero}`;
    closeModal('clientHistoryModal'); navigateToView('cotizadorView');
  }

  async function deleteQuote(id) {
    if (!await askConfirm({title:'Eliminar cotización',message:'Esta cotización se eliminará definitivamente. Esta acción no se puede deshacer.',confirmText:'Eliminar cotización'})) return;
    const { error } = await db.from('cotizaciones').delete().eq('id', id);
    if (error) return showToast(error.message, 'error');
    quoteTabs = quoteTabs.filter(t => t.existingQuoteId !== id);
    if (selectedEditingQuoteId === id) selectedEditingQuoteId='';
    await loadQuotesSummary(); if (profile.role==='admin') await loadAdminTeamData();
    if(historyClientId && !$('#clientHistoryModal').hidden) await openClientHistory(historyClientId);
    showToast('Cotización eliminada.');
  }

  async function exportQuotesCsv() {
    const rows = [['N°','Cliente','Vehículo','Modalidad','Precio USD','Precio Bs','Inicial USD','Inicial Bs','Financiado USD','Financiado Bs','Tasa','Plazo','Cuota USD','Cuota Bs','Seguro vehicular Bs','Total Bs','Fecha']];
    quotesSummary.forEach(q => {
      const c = clients.find(x=>x.id===q.cliente_id);
      rows.push([q.numero,c?.nombre_completo||'',q.vehiculo_nombre||'',purchaseModeLabel(q.modalidad_compra),q.precio_usd,q.precio_bs,q.cuota_inicial_usd,q.cuota_inicial_bs,q.monto_financiado_usd,q.monto_financiado_bs,q.tasa_interes,q.plazo_anios,q.cuota_mensual_usd,q.cuota_mensual_bs,q.seguro_vehicular_bs||0,q.cuota_total_bs||q.cuota_mensual_bs,formatDateTime(q.updated_at||q.created_at)]);
    });
    downloadCsv(`autosale-cotizaciones-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }

  // --------------------------------------------------------------
  // Clientes
  // --------------------------------------------------------------
  function clientForId(id) {
    return clients.find(c=>String(c.id)===String(id)) || adminTeamClients.find(c=>String(c.id)===String(id)) || null;
  }

  function renderClientSelect() {
    const select = $('#quoteClientSelect'); if (!select) return;
    select.innerHTML = `<option value="">Sin cliente</option>` + clients.map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)} · ${escapeHtml(c.celular)}</option>`).join('');
    select.value = clients.some(c=>c.id===selectedClientId) ? selectedClientId : '';
  }

  function populateVehicleSelects() {
    const html = `<option value="">Sin vehículo</option>` + vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.nombre)}</option>`).join('');
    $('#clientVehicle').innerHTML = html;
  }

  function teamMembers() {
    const self = { id:session.user.id, full_name:profile.full_name || 'Administrador', role:profile.role, active:true };
    return profile.role === 'admin' ? [self, ...advisors.filter(a=>a.id!==self.id)] : [self];
  }

  function populateAdvisorSelect() {
    const select = $('#clientAdvisor'); if (!select || !session || !profile) return;
    const all = teamMembers();
    select.innerHTML = all.map(a => `<option value="${a.id}">${escapeHtml(a.full_name || a.id)}${a.id===session.user.id && profile.role==='admin' ? ' (yo)' : ''}</option>`).join('');
    if (!select.value || !all.some(a=>a.id===select.value)) select.value = session.user.id;
  }

  function clientStatusClass(status) {
    return ({ vendido:'status-badge--done', perdido:'status-badge--danger', esperando_credito:'status-badge--warning', en_seguimiento:'status-badge--active' })[status] || '';
  }

  function lastActivityFromCollections(clientId, followupRows = followups, quoteRows = quotesSummary, clientRows = clients) {
    const client = clientRows.find(c=>c.id===clientId);
    const dates = [client?.updated_at || client?.created_at,
      ...followupRows.filter(f=>f.cliente_id===clientId).map(f=>f.updated_at||f.created_at),
      ...quoteRows.filter(q=>q.cliente_id===clientId).map(q=>q.updated_at||q.created_at)
    ].filter(Boolean).map(v=>new Date(v).getTime()).filter(Number.isFinite);
    return dates.length ? new Date(Math.max(...dates)).toISOString() : client?.created_at || null;
  }

  function clientCard(c) {
    const tradeinBadge = c.permuta ? `<span class="status-badge status-badge--warning">Permuta · ${escapeHtml(c.permuta.estado_revision || 'pendiente')}</span>` : '';
    const last = lastActivityForClient(c.id); const next = latestPendingFollowup(c.id); const timing = next ? followupTimingLabel(next.programado_para) : null;
    return `<article class="crm-card crm-card--compact" data-client-id="${c.id}">
      <div class="crm-card__main"><div class="crm-card__title-row"><h3>${escapeHtml(c.nombre_completo)}</h3><span class="status-badge ${clientStatusClass(c.estado)}">${escapeHtml(quoteStatusLabel(c.estado))}</span>${tradeinBadge}</div>
      <p>${escapeHtml(c.celular)}${c.vehiculo?.nombre ? ` · ${escapeHtml(c.vehiculo.nombre)}` : ''}</p>
      <div class="crm-card__meta"><span>${escapeHtml(purchaseModeLabel(c.modo_compra))}</span><span>${escapeHtml(c.origen || 'Concesionaria')}</span><span>Última actividad: ${last ? formatDateTime(last) : '—'}</span>${next ? `<span class="due-label due-label--${timing.tone}">${escapeHtml(timing.label)} · ${escapeHtml(next.tipo)}</span>` : '<span>Sin próximo seguimiento</span>'}</div></div>
      <div class="crm-card__actions crm-card__actions--quick">
        <button class="modal__primary" type="button" data-client-quote="${c.id}">+ Cotizar</button>
        <button class="modal__secondary" type="button" data-client-new-followup="${c.id}">+ Seguimiento</button>
        <button class="modal__secondary" type="button" data-client-history="${c.id}">Historial</button>
        <button class="modal__secondary" type="button" data-client-export="${c.id}">Exportar PDF</button>
        <button class="icon-text-button" type="button" data-client-edit="${c.id}">Editar</button>
      </div>
    </article>`;
  }

  function filteredClients() {
    const q = normalizeText($('#clientSearch')?.value || '');
    const status = $('#clientStatusFilter')?.value || '';
    const mode = $('#clientModeFilter')?.value || '';
    const trade = $('#clientTradeFilter')?.value || '';
    return clients.filter(c => {
      const haystack = normalizeText(`${c.nombre_completo} ${c.celular} ${c.vehiculo?.nombre || ''}`);
      if (q && !haystack.includes(q)) return false;
      if (status && c.estado !== status) return false;
      if (mode && c.modo_compra !== mode) return false;
      if (trade === 'si' && !c.permuta) return false;
      if (trade === 'no' && c.permuta) return false;
      return true;
    }).sort((a,b) => new Date(lastActivityForClient(b.id)||0) - new Date(lastActivityForClient(a.id)||0));
  }

  function renderPagination(containerId, currentPage, totalPages, dataAttr) {
    const el = $(`#${containerId}`); if (!el) return;
    if (totalPages <= 1) { el.innerHTML=''; return; }
    el.innerHTML = `<button type="button" class="pagination__btn" data-${dataAttr}="${Math.max(1,currentPage-1)}" ${currentPage<=1?'disabled':''}>←</button><span>Página ${currentPage} de ${totalPages}</span><button type="button" class="pagination__btn" data-${dataAttr}="${Math.min(totalPages,currentPage+1)}" ${currentPage>=totalPages?'disabled':''}>→</button>`;
  }

  function renderClients() {
    const list = $('#clientsList'); if (!list) return;
    const filtered = filteredClients();
    const totalPages = Math.max(1, Math.ceil(filtered.length / CLIENTS_PER_PAGE));
    clientPage = Math.min(clientPage, totalPages);
    const rows = filtered.slice((clientPage-1)*CLIENTS_PER_PAGE, clientPage*CLIENTS_PER_PAGE);
    $('#clientResultCount').textContent = `${filtered.length} cliente${filtered.length===1?'':'s'}`;
    list.innerHTML = rows.length ? rows.map(clientCard).join('') : '<div class="empty-state">No hay clientes con estos filtros.</div>';
    renderPagination('clientsPagination', clientPage, totalPages, 'client-page');
  }

  function syncClientConditionalFields() {
    $('#clientLostReasonField').hidden = $('#clientStatus')?.value !== 'perdido';
  }

  function clientDraftData() {
    if ($('#clientId')?.value) return null;
    return {
      name:$('#clientName').value, phone:$('#clientPhone').value, origin:$('#clientOrigin').value,
      vehicle:$('#clientVehicle').value, mode:$('#clientPurchaseMode').value, status:$('#clientStatus').value,
      lostReason:$('#clientLostReason').value, advisor:$('#clientAdvisor').value, notes:$('#clientNotes').value,
      hasTrade:$('#clientHasTradein').checked,
      trade:{brand:$('#tradeBrand').value,model:$('#tradeModel').value,year:$('#tradeYear').value,plate:$('#tradePlate').value,engine:$('#tradeEngine').value,fuel:$('#tradeFuel').value,price:$('#tradeEstimated').value,review:$('#tradeReview').value}
    };
  }
  function persistClientDraft() { const d=clientDraftData(); if(d) try{localStorage.setItem(userDraftKey(CLIENT_DRAFT_KEY),JSON.stringify(d));}catch(_){} }
  function restoreClientDraft() {
    let d; try { d=JSON.parse(localStorage.getItem(userDraftKey(CLIENT_DRAFT_KEY))||'null'); } catch(_) { return; }
    if (!d) return;
    $('#clientName').value=d.name||''; $('#clientPhone').value=d.phone||''; $('#clientOrigin').value=d.origin||'Concesionaria'; $('#clientVehicle').value=d.vehicle||''; $('#clientPurchaseMode').value=d.mode||'contado'; $('#clientStatus').value=d.status||'en_seguimiento'; $('#clientLostReason').value=d.lostReason||''; $('#clientAdvisor').value=d.advisor||session.user.id; $('#clientNotes').value=d.notes||'';
    $('#clientHasTradein').checked=Boolean(d.hasTrade); $('#tradeinFields').hidden=!d.hasTrade;
    const t=d.trade||{}; $('#tradeBrand').value=t.brand||''; $('#tradeModel').value=t.model||''; $('#tradeYear').value=t.year||''; $('#tradePlate').value=t.plate||''; $('#tradeEngine').value=t.engine||''; $('#tradeFuel').value=t.fuel||''; $('#tradeEstimated').value=t.price||''; $('#tradeReview').value=t.review||'pendiente';
    syncClientConditionalFields();
  }

  function clearTradeinFields() {
    ['tradeBrand','tradeModel','tradeYear','tradePlate','tradeEngine','tradeFuel','tradeEstimated'].forEach(id=>{ $(`#${id}`).value=''; });
    $('#tradeReview').value='pendiente';
  }

  async function renderAssignmentHistory(clientId) {
    const box = $('#clientAssignmentHistory');
    if (!box) return;
    if (profile.role !== 'admin' || !clientId) { box.hidden=true; box.innerHTML=''; return; }
    const { data } = await db.from('cliente_asignaciones').select('id,created_at,anterior:profiles!cliente_asignaciones_anterior_id_fkey(full_name),nuevo:profiles!cliente_asignaciones_nuevo_id_fkey(full_name),cambiado_por:profiles!cliente_asignaciones_cambiado_por_fkey(full_name)').eq('cliente_id',clientId).order('created_at',{ascending:false}).limit(8);
    if (!data?.length) { box.hidden=true; box.innerHTML=''; return; }
    box.hidden=false;
    box.innerHTML=`<div class="client-section__header"><div><span class="cotizador__tag">Asignación</span><h3>Historial de asesores</h3></div></div><div class="assignment-list">${data.map(r=>`<div><strong>${escapeHtml(r.anterior?.full_name||'Sin asignar')} → ${escapeHtml(r.nuevo?.full_name||'Sin asignar')}</strong><span>${formatDateTime(r.created_at)}${r.cambiado_por?.full_name?` · ${escapeHtml(r.cambiado_por.full_name)}`:''}</span></div>`).join('')}</div>`;
  }

  async function openClient(clientId = '') {
    const existing = clientForId(clientId);
    $('#clientId').value = existing?.id || '';
    $('#clientModalTitle').textContent = existing ? 'Editar cliente' : 'Nuevo cliente';
    $('#clientName').value = existing?.nombre_completo || '';
    $('#clientPhone').value = existing?.celular || '';
    $('#clientOrigin').value = existing?.origen || 'Concesionaria';
    $('#clientVehicle').value = existing?.vehiculo_interes_id || '';
    const allowedModes = ['contado','garante_personal','hipotecario_vehicular','hipotecado_inmueble'];
    $('#clientPurchaseMode').value = allowedModes.includes(existing?.modo_compra) ? existing.modo_compra : 'contado';
    const allowedStatuses = ['en_seguimiento','vendido','perdido','esperando_credito'];
    $('#clientStatus').value = allowedStatuses.includes(existing?.estado) ? existing.estado : 'en_seguimiento';
    $('#clientLostReason').value = existing?.motivo_perdida || '';
    $('#clientNotes').value = existing?.notas || '';
    const trade = existing?.permuta || null;
    $('#clientHasTradein').checked = Boolean(trade);
    $('#tradeinFields').hidden = !trade;
    $('#tradeBrand').value = trade?.marca || ''; $('#tradeModel').value = trade?.modelo || ''; $('#tradeYear').value = trade?.anio || ''; $('#tradePlate').value = trade?.placa || ''; $('#tradeEngine').value = trade?.motor || ''; $('#tradeFuel').value = trade?.combustible || ''; $('#tradeEstimated').value = trade?.valor_estimado ?? ''; $('#tradeReview').value = ['pendiente','revisado','rechazado'].includes(trade?.estado_revision) ? trade.estado_revision : 'pendiente';
    populateAdvisorSelect(); $('#clientAdvisor').value = existing?.asesor_id || session.user.id;
    $('#deleteClientBtn').hidden = !existing;
    syncClientConditionalFields();
    if (!existing) restoreClientDraft();
    await renderAssignmentHistory(existing?.id || '');
    openModal('clientModal');
  }

  async function saveClient(event) {
    event.preventDefault();
    const saveBtn=event.submitter||$('#clientForm button[type="submit"]'); if(saveBtn?.disabled)return; setBusy(saveBtn,true);
    try {
      const id=$('#clientId').value; let advisorId=$('#clientAdvisor').value||session.user.id; if(profile.role!=='admin')advisorId=session.user.id;
      const phone=$('#clientPhone').value.trim(), pool=profile.role==='admin'?adminTeamClients:clients;
      const duplicate=pool.find(c=>c.id!==id&&phoneKey(c.celular)&&phoneKey(c.celular)===phoneKey(phone));
      if(duplicate) throw new Error(`Ese celular ya está registrado: ${duplicate.nombre_completo}.`);
      const lost=$('#clientStatus').value==='perdido';
      const payload={nombre_completo:$('#clientName').value.trim(),celular:phone,whatsapp:null,origen:$('#clientOrigin').value.trim()||'Concesionaria',vehiculo_interes_id:$('#clientVehicle').value||null,modo_compra:$('#clientPurchaseMode').value||'contado',presupuesto_usd:null,estado:$('#clientStatus').value,motivo_perdida:lost?($('#clientLostReason').value.trim()||null):null,notas:$('#clientNotes').value.trim(),asesor_id:advisorId,creado_por:id?undefined:session.user.id};
      Object.keys(payload).forEach(k=>payload[k]===undefined&&delete payload[k]);
      const result=id?await db.from('clientes').update(payload).eq('id',id).select('*').single():await db.from('clientes').insert(payload).select('*').single();
      if(result.error){const duplicatePhone=result.error.code==='23505'||String(result.error.message||'').includes('CLIENT_PHONE_ALREADY_EXISTS');throw new Error(duplicatePhone?'Ese celular ya está registrado en AutoSale.':result.error.message);}
      const clientId=result.data.id;
      if(!id){const now=new Date(),localToday=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);const visitResult=await db.from('cliente_visitas').insert({cliente_id:clientId,fecha:localToday,notas:'',creado_por:session.user.id});if(visitResult.error)console.warn('[AutoSale] visita inicial:',visitResult.error.message);}
      if($('#clientHasTradein').checked){const tradePayload={cliente_id:clientId,marca:$('#tradeBrand').value.trim(),modelo:$('#tradeModel').value.trim(),anio:$('#tradeYear').value?Number($('#tradeYear').value):null,placa:$('#tradePlate').value.trim()||null,motor:$('#tradeEngine').value.trim()||null,combustible:$('#tradeFuel').value.trim()||null,valor_estimado:$('#tradeEstimated').value?Number($('#tradeEstimated').value):null,estado_revision:$('#tradeReview').value};const tradeResult=await db.from('cliente_permutas').upsert(tradePayload,{onConflict:'cliente_id'});if(tradeResult.error)console.warn('[AutoSale] permuta:',tradeResult.error.message);}
      else if(id){const tradeResult=await db.from('cliente_permutas').delete().eq('cliente_id',clientId);if(tradeResult.error)console.warn('[AutoSale] eliminar permuta:',tradeResult.error.message);}
      if(payload.estado==='vendido')await db.from('seguimientos').update({estado:'completado',completado_at:new Date().toISOString()}).eq('cliente_id',clientId).eq('estado','pendiente').is('deleted_at',null);
      try{localStorage.removeItem(userDraftKey(CLIENT_DRAFT_KEY));}catch(_){}
      closeModal('clientModal'); await Promise.all([loadClients(),loadFollowups(),loadQuotesSummary()]); if(profile.role==='admin')await loadAdminTeamData();
      if(!id&&clientReturnToQuote&&advisorId===session.user.id){selectedClientId=clientId;renderClientSelect();$('#quoteClientSelect').value=clientId;$('#quotePurchaseMode').value=payload.modo_compra||'contado';persistQuoteDraft();navigateToView('cotizadorView');clientReturnToQuote=false;}
      showToast(id?'Cliente actualizado.':'Cliente creado.');
    } catch(error){console.error('[AutoSale] guardar cliente:',error);showToast(error.message||'No se pudo guardar el cliente.','error');}
    finally { setBusy(saveBtn,false); }
  }

  async function deleteClient() {
    const id=$('#clientId').value; if(!id) return;
    const c=clientForId(id); if(!c) return;
    if(!await askConfirm({title:'Eliminar cliente',message:`¿Eliminar definitivamente a ${c.nombre_completo}? También se eliminarán sus cotizaciones, seguimientos, visitas y permuta. Esta acción no se puede deshacer.`,confirmText:'Eliminar definitivamente'})) return;
    const {error}=await db.from('clientes').delete().eq('id',id);
    if(error)return showToast(error.message,'error');
    closeModal('clientModal');
    if(selectedClientId===id){selectedClientId='';renderClientSelect();}
    await Promise.all([loadClients(),loadFollowups(),loadQuotesSummary()]); if(profile.role==='admin') await loadAdminTeamData();
    showToast('Cliente eliminado.');
  }

  function startQuoteForClient(clientId) {
    const c=clients.find(x=>x.id===clientId);
    if(!c)return showToast('Ese cliente no pertenece a tu cartera personal.','error');
    resetQuote(); selectedClientId=clientId; $('#quoteClientSelect').value=clientId; $('#quotePurchaseMode').value=c.modo_compra||'contado'; calc(); persistQuoteDraft(); navigateToView('cotizadorView');
  }


  function quoteHistoryCard(q) {
    const own=q.asesor_id===session.user.id;
    return `<article class="history-card"><div class="history-card__head"><div><span class="cotizador__tag">#${q.numero}</span><h3>${escapeHtml(q.vehiculo_nombre||'Sin vehículo')}</h3></div><time>${formatDateTime(q.updated_at||q.created_at)}</time></div><div class="history-card__grid"><div><span>Modalidad</span><strong>${escapeHtml(purchaseModeLabel(q.modalidad_compra))}</strong></div><div><span>Precio</span><strong>${moneyUSD(q.precio_usd)} · ${moneyBs(q.precio_bs)}</strong></div><div><span>Inicial</span><strong>${moneyUSD(q.cuota_inicial_usd)} · ${moneyBs(q.cuota_inicial_bs)}</strong></div><div><span>Financiado</span><strong>${moneyUSD(q.monto_financiado_usd)} · ${moneyBs(q.monto_financiado_bs)}</strong></div><div><span>Cuota</span><strong>${moneyUSD(q.cuota_mensual_usd)} · ${moneyBs(q.cuota_mensual_bs)}</strong></div>${Number(q.seguro_vehicular_bs||0)>0?`<div><span>Seguro vehicular</span><strong>${moneyBs(q.seguro_vehicular_bs)}</strong></div><div><span>Total</span><strong>${moneyBs(q.cuota_total_bs||q.cuota_mensual_bs)}</strong></div>`:''}</div>${own?`<div class="history-card__actions"><button type="button" class="modal__secondary" data-quote-edit="${q.id}">Editar</button><button type="button" class="danger-button" data-quote-delete="${q.id}">Eliminar</button></div>`:''}</article>`;
  }

  function renderClientHistory() {
    const qPages=Math.max(1,Math.ceil(historyQuotes.length/HISTORY_PER_PAGE)); historyQuotePage=Math.min(historyQuotePage,qPages);
    const fPages=Math.max(1,Math.ceil(historyFollowups.length/HISTORY_PER_PAGE)); historyFollowupPage=Math.min(historyFollowupPage,fPages);
    const qRows=historyQuotes.slice((historyQuotePage-1)*HISTORY_PER_PAGE,historyQuotePage*HISTORY_PER_PAGE);
    const fRows=historyFollowups.slice((historyFollowupPage-1)*HISTORY_PER_PAGE,historyFollowupPage*HISTORY_PER_PAGE);
    $('#historyQuotesCount').textContent=`${historyQuotes.length}`; $('#historyFollowupsCount').textContent=`${historyFollowups.length}`;
    $('#historyQuotesList').innerHTML=qRows.length?qRows.map(quoteHistoryCard).join(''):'<div class="empty-state">Este cliente todavía no tiene cotizaciones.</div>';
    $('#historyFollowupsList').innerHTML=fRows.length?fRows.map(followupHistoryCard).join(''):'<div class="empty-state">Este cliente todavía no tiene seguimientos.</div>';
    renderPagination('historyQuotesPagination',historyQuotePage,qPages,'history-quote-page');
    renderPagination('historyFollowupsPagination',historyFollowupPage,fPages,'history-followup-page');
  }

  async function openClientHistory(clientId) {
    const client=clientForId(clientId); if(!client)return showToast('No se encontró el cliente.','error');
    historyClientId=clientId; historyQuotePage=1; historyFollowupPage=1;
    $('#clientHistoryTitle').textContent=`Historial · ${client.nombre_completo}`;
    $('#historyQuotesList').innerHTML='<div class="empty-state">Cargando…</div>'; $('#historyFollowupsList').innerHTML='<div class="empty-state">Cargando…</div>'; openModal('clientHistoryModal');
    const [q,f]=await Promise.all([
      db.from('cotizaciones').select('id,numero,cliente_id,asesor_id,vehiculo_id,vehiculo_nombre,precio_usd,precio_bs,cuota_inicial_usd,cuota_inicial_bs,monto_financiado_usd,monto_financiado_bs,tasa_interes,plazo_anios,cuota_mensual_usd,cuota_mensual_bs,modalidad_compra,seguro_vehicular_bs,cuota_total_bs,created_at,updated_at').eq('cliente_id',clientId).is('deleted_at',null).order('updated_at',{ascending:false}),
      db.from('seguimientos').select('id,cliente_id,asesor_id,tipo,programado_para,estado,notas,completado_at,created_at,updated_at,asesor:profiles!seguimientos_asesor_id_fkey(id,full_name),cliente:clientes(id,nombre_completo)').eq('cliente_id',clientId).is('deleted_at',null).order('created_at',{ascending:false})
    ]);
    if(q.error||f.error){showToast(q.error?.message||f.error?.message||'No se pudo cargar el historial.','error');}
    historyQuotes=q.data||[]; historyFollowups=f.data||[]; renderClientHistory();
  }

  async function logoDataUrl() {
    try { const r=await fetch('logo.png'); const b=await r.blob(); return await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(b);}); } catch(_) { return null; }
  }

  function slugFile(value) { return normalizeText(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'cliente'; }

  async function exportClientPdf(clientId) {
    const client=clientForId(clientId); if(!client)return showToast('No se encontró el cliente.','error');
    if(!window.jspdf?.jsPDF)return showToast('No se pudo cargar el generador PDF. Revisa tu conexión e inténtalo nuevamente.','error');
    showToast('Generando PDF…');
    const [q,f,logo]=await Promise.all([
      db.from('cotizaciones').select('*').eq('cliente_id',clientId).is('deleted_at',null).order('updated_at',{ascending:false}),
      db.from('seguimientos').select('*').eq('cliente_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}),
      logoDataUrl()
    ]);
    if(q.error||f.error)return showToast(q.error?.message||f.error?.message||'No se pudo reunir la información.','error');
    const { jsPDF }=window.jspdf; const doc=new jsPDF({unit:'mm',format:'a4'}); const pageW=doc.internal.pageSize.getWidth();
    if(logo){try{doc.addImage(logo,'PNG',14,10,20,20);}catch(_){}}
    doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text('AutoSale Motors',40,18);doc.setFontSize(11);doc.text('Expediente de cliente',40,25);
    doc.setDrawColor(220);doc.line(14,34,pageW-14,34);doc.setFontSize(13);doc.text(client.nombre_completo||'Cliente',14,43);
    const info=[['Celular',client.celular||'—'],['Origen',client.origen||'Concesionaria'],['Estado',quoteStatusLabel(client.estado)],['Modo',purchaseModeLabel(client.modo_compra)],['Vehículo de interés',client.vehiculo?.nombre||'—'],['Notas',client.notas||'—']];
    doc.autoTable({startY:48,head:[['Dato','Información']],body:info,styles:{fontSize:9,cellPadding:2.5},headStyles:{fillColor:[11,31,54]}});
    let y=doc.lastAutoTable.finalY+8; doc.setFontSize(13);doc.text('Cotizaciones',14,y);
    const qRows=(q.data||[]).map(x=>[String(x.numero||''),x.vehiculo_nombre||'—',purchaseModeLabel(x.modalidad_compra),moneyUSD(x.precio_usd),x.modalidad_compra==='contado'?'—':moneyUSD(x.cuota_inicial_usd),x.modalidad_compra==='contado'?'—':moneyBs(x.cuota_total_bs||x.cuota_mensual_bs),formatDateTime(x.updated_at||x.created_at)]);
    doc.autoTable({startY:y+4,head:[['N°','Vehículo','Modalidad','Precio','Inicial','Cuota/Total','Fecha']],body:qRows.length?qRows:[['—','Sin cotizaciones','—','—','—','—','—']],styles:{fontSize:7.5,cellPadding:2},headStyles:{fillColor:[11,31,54]}});
    y=doc.lastAutoTable.finalY+8; if(y>250){doc.addPage();y=18;} doc.setFontSize(13);doc.text('Seguimientos',14,y);
    const fRows=(f.data||[]).map(x=>[x.tipo||'Seguimiento',x.estado==='completado'?'Completado':'Vigente',formatDateTime(x.programado_para),x.notas||'—']);
    doc.autoTable({startY:y+4,head:[['Tipo','Estado','Programado','Notas']],body:fRows.length?fRows:[['—','—','Sin seguimientos','—']],styles:{fontSize:8,cellPadding:2},headStyles:{fillColor:[11,31,54]}});
    const pages=doc.getNumberOfPages(); for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(7);doc.setTextColor(100);doc.text(`AutoSale Motors · Página ${i} de ${pages}`,14,290);}
    doc.save(`autosale-${slugFile(client.nombre_completo)}-${new Date().toISOString().slice(0,10)}.pdf`); showToast('PDF generado.');
  }

  function populateFollowupClients() {
    const select=$('#followupClient'); if(!select)return;
    select.innerHTML=clients.map(c=>`<option value="${c.id}">${escapeHtml(c.nombre_completo)} · ${escapeHtml(c.celular)}</option>`).join('');
  }

  // --------------------------------------------------------------
  // Seguimientos
  // --------------------------------------------------------------
  function followupHistoryCard(f) {
    const date = formatDateTime(f.programado_para);
    const created = f.created_at ? formatDateTime(f.created_at) : '';
    const completed = f.completado_at ? formatDateTime(f.completado_at) : '';
    const own = f.asesor_id === session.user.id;
    return `<article class="history-card history-card--followup">
      <div class="history-card__head"><div><span class="status-badge">${escapeHtml(f.tipo || 'Seguimiento')}</span><h3>${escapeHtml(f.cliente?.nombre_completo || clientForId(f.cliente_id)?.nombre_completo || 'Seguimiento')}</h3></div><span class="status-badge ${f.estado === 'completado' ? 'status-badge--done' : ''}">${f.estado === 'completado' ? 'Completado' : 'Vigente'}</span></div>
      <div class="history-card__followup-date">${escapeHtml(date)}</div>${f.notas ? `<p>${escapeHtml(f.notas)}</p>` : ''}
      <small>Registrado: ${escapeHtml(created)}${completed ? ` · Completado: ${escapeHtml(completed)}` : ''}${f.asesor?.full_name ? ` · ${escapeHtml(f.asesor.full_name)}` : ''}</small>
      ${own?`<div class="history-card__actions"><button type="button" class="modal__secondary" data-followup-edit="${f.id}">Editar</button><button type="button" class="danger-button" data-followup-delete="${f.id}" data-followup-client="${f.cliente_id || historyClientId}">Eliminar</button></div>`:''}
    </article>`;
  }

  function latestFollowupsForMain() {
    const q=normalizeText($('#followupSearch')?.value||''); const type=$('#followupFilter')?.value||'';
    const byClient=new Map();
    followups.filter(f=>f.estado==='pendiente').forEach(f=>{
      if(type && f.tipo!==type) return;
      if(q && !normalizeText(f.cliente?.nombre_completo||'').includes(q)) return;
      const old=byClient.get(f.cliente_id);
      const t=new Date(f.programado_para||f.created_at||0).getTime();
      const oldT=old?new Date(old.programado_para||old.created_at||0).getTime():-Infinity;
      if(!old || t>oldT) byClient.set(f.cliente_id,f);
    });
    return [...byClient.values()].sort((a,b)=>{
      const at=a.programado_para?new Date(a.programado_para).getTime():Infinity;
      const bt=b.programado_para?new Date(b.programado_para).getTime():Infinity;
      return at-bt;
    });
  }

  function followupCard(f) {
    const timing=followupTimingLabel(f.programado_para);
    return `<article class="crm-card crm-card--compact followup-card"><div class="crm-card__main"><div class="crm-card__title-row"><h3>${escapeHtml(f.cliente?.nombre_completo||'Cliente')}</h3><span class="status-badge">${escapeHtml(f.tipo)}</span><span class="due-label due-label--${timing.tone}">${escapeHtml(timing.label)}</span></div><p>${escapeHtml(formatDateTime(f.programado_para))}</p><small>${escapeHtml(f.notas||'Sin notas')}</small></div><div class="crm-card__actions"><button class="modal__secondary" type="button" data-followup-edit="${f.id}">Editar</button><button class="modal__secondary" type="button" data-followup-complete="${f.id}">Completar</button><button class="danger-button" type="button" data-followup-delete="${f.id}" data-followup-client="${f.cliente_id}">Eliminar</button></div></article>`;
  }

  function renderFollowups() {
    const list=$('#followupsList'); if(!list) return;
    const rows=latestFollowupsForMain();
    const totalPages=Math.max(1,Math.ceil(rows.length/FOLLOWUPS_PER_PAGE)); followupPage=Math.min(followupPage,totalPages);
    const pageRows=rows.slice((followupPage-1)*FOLLOWUPS_PER_PAGE,followupPage*FOLLOWUPS_PER_PAGE);
    $('#followupResultCount').textContent=`${rows.length} vigente${rows.length===1?'':'s'}`;
    if(!pageRows.length){list.innerHTML='<div class="empty-state">No hay seguimientos vigentes para estos filtros.</div>';renderPagination('followupsPagination',followupPage,totalPages,'followup-page');return;}
    const order=['vencidos','hoy','manana','semana','adelante','sin_fecha'];
    const groups={}; pageRows.forEach(f=>{const info=followupTimingLabel(f.programado_para);(groups[info.key]??={label:info.label,tone:info.tone,rows:[]}).rows.push(f);});
    list.innerHTML=order.filter(k=>groups[k]).map(k=>`<section class="followup-group"><header><span class="due-label due-label--${groups[k].tone}">${escapeHtml(groups[k].label)}</span><small>${groups[k].rows.length}</small></header><div class="crm-list crm-list--compact">${groups[k].rows.map(followupCard).join('')}</div></section>`).join('');
    renderPagination('followupsPagination',followupPage,totalPages,'followup-page');
  }

  async function getFollowupById(id) {
    const local=followups.find(f=>String(f.id)===String(id)) || adminTeamFollowups.find(f=>String(f.id)===String(id)); if(local) return local;
    const {data,error}=await db.from('seguimientos').select('*,cliente:clientes(id,nombre_completo,celular,estado),asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)').eq('id',id).single();
    if(error){showToast(error.message,'error');return null;} return data;
  }

  async function openFollowup(clientId = '', followupId = '') {
    const item=followupId?await getFollowupById(followupId):null;
    if(item && item.asesor_id!==session.user.id) return showToast('Puedes revisar este seguimiento desde Administración, pero solo el asesor asignado puede editarlo.','error');
    $('#followupId').value=item?.id||'';
    $('#followupModalTitle').textContent=item?'Editar seguimiento':'Nuevo seguimiento';
    $('#followupClient').value=item?.cliente_id||clientId||clients[0]?.id||'';
    $('#followupType').value=FOLLOWUP_TYPES.includes(item?.tipo)?item.tipo:'Esperando visita';
    let parts=item?localDateTimeParts(item.programado_para):localDateTimeParts(new Date(Date.now()+86400000));
    if(!item){parts.time='09:00';}
    $('#followupDate').value=parts.date; $('#followupTime').value=parts.time||'09:00'; $('#followupNotes').value=item?.notas||'';
    $('#saveFollowupBtn').textContent=item?'Guardar cambios':'Guardar seguimiento';
    openModal('followupModal');
  }

  async function saveFollowup(event) {
    event.preventDefault();
    const id=$('#followupId').value, clientId=$('#followupClient').value; if(!clientId)return showToast('Selecciona un cliente.','error');
    const client=clients.find(c=>c.id===clientId); if(!client)return showToast('Solo puedes crear seguimientos para tu propia cartera.','error');
    const dateTime=combineLocalDateTime($('#followupDate').value,$('#followupTime').value); if(!dateTime)return showToast('Selecciona una fecha válida.','error');
    const payload={cliente_id:clientId,asesor_id:session.user.id,tipo:$('#followupType').value,programado_para:dateTime,estado:'pendiente',notas:$('#followupNotes').value.trim(),completado_at:null,creado_por:session.user.id};
    const btn=$('#saveFollowupBtn'); setBusy(btn,true);
    try {
      const result=id?await db.from('seguimientos').update(payload).eq('id',id).select('id').single():await db.from('seguimientos').insert(payload).select('id').single();
      if(result.error)throw result.error;
      const {error:closeOldError}=await db.from('seguimientos').update({estado:'completado',completado_at:new Date().toISOString()}).eq('cliente_id',clientId).eq('estado','pendiente').neq('id',result.data.id).is('deleted_at',null);
      if(closeOldError) console.warn('[AutoSale] cerrar seguimiento anterior:',closeOldError.message);
      closeModal('followupModal'); await loadFollowups(); if(profile.role==='admin')await loadAdminTeamData(); if(historyClientId===clientId&&!$('#clientHistoryModal').hidden)await openClientHistory(clientId); showToast(id?'Seguimiento actualizado.':'Seguimiento creado.');
    } catch(error){console.error(error);showToast(error.message||'No se pudo guardar el seguimiento.','error');}
    finally { setBusy(btn,false); if(!$('#followupModal').hidden) btn.textContent=id?'Guardar cambios':'Guardar seguimiento'; }
  }

  async function toggleFollowup(id) {
    const item=await getFollowupById(id); if(!item||item.asesor_id!==session.user.id)return;
    const completed=item.estado!=='completado';
    const {error}=await db.from('seguimientos').update({estado:completed?'completado':'pendiente',completado_at:completed?new Date().toISOString():null}).eq('id',id);
    if(error)return showToast(error.message,'error'); await loadFollowups(); if(profile.role==='admin')await loadAdminTeamData(); showToast(completed?'Seguimiento completado.':'Seguimiento reabierto.');
  }

  async function deleteFollowup(id, clientId) {
    const item=await getFollowupById(id); if(!item)return;
    if(item.asesor_id!==session.user.id)return showToast('Solo el asesor asignado puede eliminar este seguimiento.','error');
    if(!await askConfirm({title:'Eliminar seguimiento',message:'Este seguimiento se eliminará definitivamente. Esta acción no se puede deshacer.',confirmText:'Eliminar seguimiento'}))return;
    const {error}=await db.from('seguimientos').delete().eq('id',id); if(error)return showToast(error.message,'error');
    await loadFollowups(); if(profile.role==='admin')await loadAdminTeamData(); if(historyClientId===clientId && !$('#clientHistoryModal').hidden) await openClientHistory(clientId); showToast('Seguimiento eliminado.');
  }


  // --------------------------------------------------------------
  // Administración: vehículos, configuración y equipo
  // --------------------------------------------------------------
  function filteredAdminVehicles() {
    const q = normalizeText($('#vehicleAdminSearch')?.value || '');
    return vehicles.filter(v => !q || normalizeText(`${v.nombre} ${v.estado_interno || ''}`).includes(q));
  }

  function renderVehicleAdmin() {
    const list = $('#adminVehicleList'); if (!list) return;
    const filtered = filteredAdminVehicles();
    const totalPages = Math.max(1, Math.ceil(filtered.length / VEHICLES_PER_PAGE));
    vehicleAdminPage = Math.min(vehicleAdminPage, totalPages);
    const pageRows = filtered.slice((vehicleAdminPage - 1) * VEHICLES_PER_PAGE, vehicleAdminPage * VEHICLES_PER_PAGE);
    $('#adminVehicleCount').textContent = filtered.length;
    list.innerHTML = pageRows.length ? pageRows.map(v => `<article class="vehicle-list__item">
      <div class="vehicle-list__info"><strong>${escapeHtml(v.nombre)}</strong><span>${moneyUSD(v.precio)}</span><small>${escapeHtml(v.estado_interno || 'disponible')}</small></div>
      <div class="vehicle-list__actions"><button type="button" class="modal__secondary" data-edit-vehicle="${v.id}">Editar</button><button type="button" class="danger-button" data-delete-vehicle="${v.id}">Eliminar</button></div>
    </article>`).join('') : '<div class="vehicle-list__empty"><strong>No hay vehículos.</strong><small>Prueba otro término de búsqueda.</small></div>';
    renderPagination('vehicleAdminPagination', vehicleAdminPage, totalPages, 'vehicle-page');
  }
  function resetVehicleForm() {
    $('#vehicleId').value=''; $('#vehicleName').value=''; $('#vehiclePriceUsd').value=''; $('#vehicleInternalStatus').value='disponible'; $('#saveVehicleBtn').textContent='Agregar vehículo';
  }
  function openVehicleAdmin(id='') {
    resetVehicleForm();
    const v = vehicles.find(x => String(x.id) === String(id));
    if (v) {
      $('#vehicleId').value=v.id; $('#vehicleName').value=v.nombre; $('#vehiclePriceUsd').value=v.precio; $('#vehicleInternalStatus').value=v.estado_interno || 'disponible'; $('#saveVehicleBtn').textContent='Guardar cambios';
    }
    vehicleAdminPage = 1;
    if ($('#vehicleAdminSearch')) $('#vehicleAdminSearch').value = '';
    renderVehicleAdmin(); openModal('vehicleAdminModal');
  }

  async function saveVehicle(event) {
    event.preventDefault();
    const btn = $('#saveVehicleBtn'); if (btn?.disabled) return;
    const id = $('#vehicleId').value;
    const payload = { nombre: $('#vehicleName').value.trim(), precio: Number($('#vehiclePriceUsd').value), precio_bs_manual: null, precio_bs_modo: 'tipo_cambio', estado_interno: $('#vehicleInternalStatus').value };
    if (!payload.nombre || !Number.isFinite(payload.precio) || payload.precio < 0) return showToast('Completa nombre y precio correctamente.', 'error');
    setBusy(btn,true); $('#vehicleAdminStatus').textContent='● Guardando…';
    try {
      const result = id ? await db.from('vehiculos').update(payload).eq('id', id).select('*').single() : await db.from('vehiculos').insert(payload).select('*').single();
      if (result.error) throw result.error;
      await loadVehicles(); resetVehicleForm();
      $('#vehicleAdminStatus').textContent='● Guardado';
      showToast(id ? 'Vehículo actualizado.' : 'Vehículo agregado.');
    } catch (error) {
      console.error('[AutoSale] guardar vehículo:', error); $('#vehicleAdminStatus').textContent='● Error al guardar'; showToast(error.message || 'No se pudo guardar el vehículo.', 'error');
    } finally { setBusy(btn,false); }
  }
  async function deleteVehicle(id) {
    if (!await askConfirm({title:'Eliminar vehículo',message:'El vehículo se eliminará del inventario interno. Esta acción no se puede deshacer.',confirmText:'Eliminar vehículo'})) return;
    const { error } = await db.from('vehiculos').delete().eq('id', id); if (error) return showToast(error.message, 'error');
    await loadVehicles(); showToast('Vehículo eliminado.');
  }

  async function saveSettings(event) {
    event.preventDefault(); const btn=event.submitter || $('#settingsForm button[type="submit"]'); setBusy(btn,true);
    const payload={id:1,tipo_cambio:Number($('#settingTc').value),seguro_desgravamen:Number($('#settingInsurance').value),seguro_vehicular_mensual:Number($('#settingVehicleInsurance').value),seguro_inmueble_mensual:Number($('#settingPropertyInsurance').value),updated_by:session.user.id};
    try {
      const {error}=await db.from('app_settings').upsert(payload); if(error)throw error; settings={...settings,...payload}; $('#tc').value=settings.tipo_cambio; $('#tasa').value=RATE_DEFAULT; updateChipGroup('chips-tasa',RATE_DEFAULT,'val'); calc(); persistQuoteDraft(); showToast('Configuración guardada.');
    } catch(error){showToast(error.message||'No se pudo guardar la configuración.','error');}
    finally { setBusy(btn,false); }
  }

  function memberById(id) {
    if (id === session.user.id) return {id:session.user.id,full_name:profile.full_name||'Administrador',role:'admin',active:true};
    return advisors.find(a=>a.id===id) || null;
  }

  function advisorStats(member) {
    const memberClients=adminTeamClients.filter(c=>c.asesor_id===member.id);
    const pending=adminTeamFollowups.filter(f=>f.asesor_id===member.id&&f.estado==='pendiente');
    const overdue=pending.filter(f=>f.programado_para&&new Date(f.programado_para)<new Date()).length;
    const quotes=adminTeamQuotes.filter(q=>q.asesor_id===member.id);
    const weekAgo=Date.now()-7*86400000;
    const noMovement=memberClients.filter(c=>daysSince(lastActivityFromCollections(c.id,adminTeamFollowups,adminTeamQuotes,adminTeamClients))>=15).length;
    return { memberClients,pending,overdue,quotes,weekQuotes:quotes.filter(q=>new Date(q.updated_at||q.created_at).getTime()>=weekAgo).length,noMovement,count:s=>memberClients.filter(c=>c.estado===s).length };
  }

  function renderAdvisors() {
    const pendingBox=$('#advisorPendingList'),box=$('#advisorsList'); if(!box||profile?.role!=='admin')return;
    const pending=advisors.filter(a=>a.approval_status==='pending');
    if(pendingBox) pendingBox.innerHTML=pending.length?`<div class="section-heading"><h4>Solicitudes pendientes</h4><span class="result-count">${pending.length}</span></div>`+pending.map(a=>`<div class="advisor-row advisor-row--pending"><div class="advisor-row__identity"><strong>${escapeHtml(a.full_name||'Sin nombre')}</strong><span>Pendiente de aprobación · ${escapeHtml(a.credential_type==='pin'?'PIN':'Contraseña')}</span></div><div class="advisor-row__actions"><button type="button" class="modal__primary" data-advisor-approve="${a.id}">Aprobar</button><button type="button" class="danger-button" data-advisor-reject="${a.id}">Rechazar</button></div></div>`).join(''):'<div class="empty-state empty-state--small">No hay solicitudes pendientes.</div>';
    const activeRows=advisors.filter(a=>a.approval_status!=='pending'); const pages=Math.max(1,Math.ceil(activeRows.length/ADVISORS_PER_PAGE)); advisorPage=Math.min(advisorPage,pages); const pageRows=activeRows.slice((advisorPage-1)*ADVISORS_PER_PAGE,advisorPage*ADVISORS_PER_PAGE);
    box.innerHTML=pageRows.length?pageRows.map(a=>{
      const st=advisorStats(a), rejected=a.approval_status==='rejected', status=rejected?'Rechazado':(a.active?'Activo':'Desactivado');
      const stateAction=rejected
        ? `<button type="button" class="modal__primary" data-advisor-approve="${a.id}">Aprobar</button>`
        : `<button type="button" class="modal__secondary" data-advisor-toggle="${a.id}" data-active="${a.active?'1':'0'}">${a.active?'Desactivar':'Activar'}</button>`;
      return `<div class="advisor-row"><div class="advisor-row__identity"><strong>${escapeHtml(a.full_name||'Sin nombre')}</strong><span>${status} · ${escapeHtml(a.credential_type==='pin'?'PIN':'Contraseña')} · ${st.memberClients.length} clientes · ${st.pending.length} seguimientos</span></div><div class="advisor-row__actions"><button type="button" class="modal__secondary" data-advisor-view="${a.id}">Ver cartera</button><button type="button" class="modal__secondary" data-advisor-passkeys="${a.id}">Revocar acceso rápido</button>${stateAction}<button type="button" class="danger-button" data-advisor-delete="${a.id}">Eliminar</button></div></div>`;
    }).join(''):'<div class="empty-state">No hay asesores registrados.</div>';
    renderPagination('advisorsPagination',advisorPage,pages,'advisor-page-main');
  }

  async function setAdvisorApproval(userId,status) {
    const active=status==='approved'; const {error}=await db.from('profiles').update({approval_status:status,active}).eq('id',userId);
    if(error)return showToast(error.message,'error'); await Promise.all([loadAdvisors(),loadAdminTeamData()]); showToast(status==='approved'?'Asesor aprobado.':'Solicitud rechazada.');
  }

  function renderAdvisorActivity() {
    const container=$('#advisorActivityList'); if(!container||profile?.role!=='admin')return;
    const currentAdmin={id:session.user.id,full_name:profile.full_name||'Administrador',role:'admin',active:true};
    const team=[currentAdmin,...advisors.filter(a=>a.id!==currentAdmin.id)];
    container.innerHTML=team.map(member=>{
      const st=advisorStats(member);
      return `<article class="advisor-monitor"><header class="advisor-monitor__head"><div><strong>${escapeHtml(member.full_name||'Sin nombre')}</strong><span>${member.role==='admin'?'Administrador':'Asesor'} · ${member.active===false?'Desactivado':'Activo'}</span></div><button class="modal__secondary" type="button" data-advisor-view="${member.id}">Ver clientes</button></header><div class="advisor-monitor__metrics"><div><strong>${st.memberClients.length}</strong><span>Clientes</span></div><div><strong>${st.count('en_seguimiento')}</strong><span>En seguimiento</span></div><div><strong>${st.count('esperando_credito')}</strong><span>Esperando crédito</span></div><div><strong>${st.count('vendido')}</strong><span>Vendidos</span></div><div><strong>${st.count('perdido')}</strong><span>Perdidos</span></div><div><strong>${st.pending.length}</strong><span>Seguimientos</span></div><div><strong>${st.overdue}</strong><span>Vencidos</span></div><div><strong>${st.weekQuotes}</strong><span>Cotizaciones 7 días</span></div><div><strong>${st.noMovement}</strong><span>Sin movimiento 15+ días</span></div></div></article>`;
    }).join('')||'<div class="empty-state">No hay usuarios comerciales.</div>';
  }

  function renderAdvisorDetail(memberId) {
    const member=memberById(memberId); if(!member)return;
    advisorDetailId=memberId;
    const st=advisorStats(member);
    $('#advisorDetailTitle').textContent=`Cartera · ${member.full_name||'Usuario'}`;
    $('#advisorDetailSummary').innerHTML=`<div class="metric"><strong>${st.memberClients.length}</strong><span>Clientes</span></div><div class="metric"><strong>${st.pending.length}</strong><span>Seguimientos</span></div><div class="metric"><strong>${st.quotes.length}</strong><span>Cotizaciones</span></div><div class="metric"><strong>${st.count('vendido')}</strong><span>Vendidos</span></div>`;
    const q=normalizeText($('#advisorDetailSearch')?.value||'');
    const rows=st.memberClients.filter(c=>!q||normalizeText(`${c.nombre_completo} ${c.celular} ${c.vehiculo?.nombre||''}`).includes(q));
    const totalPages=Math.max(1,Math.ceil(rows.length/ADVISOR_CLIENTS_PER_PAGE));
    advisorDetailPage=Math.min(advisorDetailPage,totalPages);
    const pageRows=rows.slice((advisorDetailPage-1)*ADVISOR_CLIENTS_PER_PAGE,advisorDetailPage*ADVISOR_CLIENTS_PER_PAGE);
    const list=$('#advisorDetailClients');
    list.innerHTML=pageRows.length?pageRows.map(c=>{
      const follow=adminTeamFollowups.filter(f=>f.cliente_id===c.id&&f.estado==='pendiente').sort((a,b)=>new Date(a.programado_para||0)-new Date(b.programado_para||0))[0];
      const quotes=adminTeamQuotes.filter(q=>q.cliente_id===c.id).length;
      return `<article class="crm-card crm-card--compact"><div class="crm-card__main"><div class="crm-card__title-row"><h3>${escapeHtml(c.nombre_completo)}</h3><span class="status-badge ${clientStatusClass(c.estado)}">${escapeHtml(quoteStatusLabel(c.estado))}</span></div><p>${escapeHtml(c.celular)}${c.vehiculo?.nombre?` · ${escapeHtml(c.vehiculo.nombre)}`:''}</p><div class="crm-card__meta"><span>${quotes} cotización${quotes===1?'':'es'}</span><span>${follow?`${escapeHtml(follow.tipo)} · ${escapeHtml(formatDateTime(follow.programado_para))}`:'Sin seguimiento vigente'}</span>${c.permuta?`<span>Permuta: ${escapeHtml(c.permuta.estado_revision||'pendiente')}</span>`:''}</div></div><div class="crm-card__actions"><button class="modal__secondary" data-admin-client-edit="${c.id}">Ver cliente</button><button class="modal__secondary" data-admin-client-history="${c.id}">Historial</button><button class="modal__secondary" data-admin-client-export="${c.id}">Exportar PDF</button></div></article>`;
    }).join(''):'<div class="empty-state">No hay clientes para esta búsqueda.</div>';
    renderPagination('advisorDetailPagination',advisorDetailPage,totalPages,'advisor-page');
  }

  function openAdvisorDetail(memberId) {
    advisorDetailPage=1;
    if ($('#advisorDetailSearch')) $('#advisorDetailSearch').value='';
    renderAdvisorDetail(memberId); openModal('advisorDetailModal');
  }

  function populateReassignSelects() {
    if(profile?.role!=='admin')return;
    const all=teamMembers();
    ['reassignFrom','reassignTo'].forEach(id=>{const el=$(`#${id}`);if(!el)return;const old=el.value;el.innerHTML=all.map(a=>`<option value="${a.id}">${escapeHtml(a.full_name||'Sin nombre')}</option>`).join('');if(old&&all.some(a=>a.id===old))el.value=old;});
    if($('#reassignTo') && $('#reassignTo').value===$('#reassignFrom')?.value && all.length>1) $('#reassignTo').value=all[1].id;
  }

  async function bulkReassignClients() {
    const from=$('#reassignFrom').value,to=$('#reassignTo').value;if(!from||!to||from===to)return showToast('Selecciona dos usuarios distintos.','error');
    const count=adminTeamClients.filter(c=>c.asesor_id===from).length;if(!count)return showToast('Ese usuario no tiene clientes activos.','error');
    if(!await askConfirm({title:'Reasignar cartera',message:`¿Reasignar ${count} cliente(s) al usuario seleccionado?`,confirmText:'Reasignar',danger:false}))return;
    const {error}=await db.from('clientes').update({asesor_id:to}).eq('asesor_id',from);if(error)return showToast(error.message,'error');
    await Promise.all([loadClients(),loadAdminTeamData()]);showToast(`${count} cliente(s) reasignados.`);
  }

  async function edgeErrorMessage(error) {
    try {
      if (error?.context && typeof error.context.clone === 'function') {
        const payload=await error.context.clone().json(); if(payload?.error)return payload.error;
      }
    } catch(_){}
    return String(error?.message||'Error en la función segura.');
  }

  async function adminUserAction(body) {
    const {data,error}=await db.functions.invoke('admin-user',{body});
    if(error) throw new Error(await edgeErrorMessage(error));
    if(data?.error) throw new Error(data.error);
    return data;
  }

  async function toggleAdvisorActive(userId, active) {
    const {error}=await db.from('profiles').update({active:!active}).eq('id',userId); if(error)return showToast(error.message,'error');
    await loadAdvisors(); await loadAdminTeamData(); showToast(!active?'Asesor activado.':'Asesor desactivado.');
  }

  async function revokeAdvisorPasskeys(userId) {
    const a=advisors.find(x=>x.id===userId); if(!a)return;
    if(!await askConfirm({title:'Revocar acceso rápido',message:`¿Revocar los accesos con huella/PIN de ${a.full_name||'este asesor'}?`,confirmText:'Revocar'}))return;
    try { await adminUserAction({action:'revoke-passkeys',user_id:userId}); showToast('Accesos rápidos revocados.'); }
    catch(error){showToast(error.message,'error');}
  }

  async function deleteAdvisor(userId) {
    const a=advisors.find(x=>x.id===userId); if(!a)return;
    const assigned=adminTeamClients.filter(c=>c.asesor_id===userId).length;
    if(assigned>0)return showToast(`Reasigna primero sus ${assigned} cliente(s). Después podrás eliminar la cuenta.`, 'error');
    if(!await askConfirm({title:'Eliminar asesor',message:`¿Eliminar definitivamente la cuenta de ${a.full_name||'este asesor'}? El historial sin cliente se reasignará al administrador.`,confirmText:'Eliminar cuenta'}))return;
    try { await adminUserAction({action:'delete-user',user_id:userId}); await Promise.all([loadAdvisors(),loadAdminTeamData()]); showToast('Asesor eliminado.'); }
    catch(error){showToast(error.message,'error');}
  }

  function renderDashboard() {
    if (profile?.role !== 'admin') return;
    $('#settingTc').value=settings.tipo_cambio ?? 6.96;
    $('#settingInsurance').value=settings.seguro_desgravamen ?? DESGRAVAMEN_DEFAULT;
    $('#settingVehicleInsurance').value=settings.seguro_vehicular_mensual ?? VEHICLE_INSURANCE_DEFAULT;
    $('#settingPropertyInsurance').value=settings.seguro_inmueble_mensual ?? PROPERTY_INSURANCE_DEFAULT;
    $('#adminVehicleSummary').innerHTML = `<div class="metric"><strong>${vehicles.length}</strong><span>Vehículos</span></div>`;
    renderAdvisors(); renderAdvisorActivity(); populateReassignSelects();
  }

  // --------------------------------------------------------------
  // Catálogo web (solo admin)
  // --------------------------------------------------------------
  function publicName(v) { return [v.public_brand, v.public_model, v.public_version].filter(Boolean).join(' '); }

  function safeFileName(name) {
    return String(name || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  }

  async function uploadCatalogFile(file, folder = 'vehiculos') {
    if (!file) return null;
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
    const path = `${folder}/${crypto.randomUUID()}-${safeFileName(file.name.replace(new RegExp(`${ext}$`), ''))}${ext}`;
    const { error } = await db.storage.from('catalogo').upload(path, file, { upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    const { data } = db.storage.from('catalogo').getPublicUrl(path);
    return data.publicUrl;
  }
  function renderCatalogAdmin() {
    const list = $('#catalogAdminList'); if (!list) return;
    const q = normalizeText($('#catalogSearch')?.value || '');
    const rows = vehicles.filter(v => !q || normalizeText(publicName(v) || v.nombre).includes(q));
    const totalPages = Math.max(1, Math.ceil(rows.length / CATALOG_PER_PAGE));
    catalogPage = Math.min(catalogPage, totalPages);
    const pageRows = rows.slice((catalogPage - 1) * CATALOG_PER_PAGE, catalogPage * CATALOG_PER_PAGE);
    list.innerHTML = pageRows.length ? pageRows.map(v => `<article class="catalog-admin-card"><div class="catalog-admin-card__image">${v.public_image_url ? `<img src="${escapeHtml(v.public_image_url)}" alt="${escapeHtml(publicName(v) || v.nombre)}">` : '<span>Sin imagen</span>'}</div><div class="catalog-admin-card__body"><div class="catalog-admin-card__status"><span class="status-badge">${v.public_published ? 'Publicado' : 'Borrador'}</span>${v.public_featured ? '<span class="status-badge status-badge--warning">Destacado</span>' : ''}${v.public_offer ? '<span class="status-badge status-badge--offer">Oferta</span>' : ''}</div><h3>${escapeHtml(publicName(v) || v.nombre)}</h3><p>${escapeHtml(v.public_engine || 'Motor por definir')}</p><button class="modal__secondary" type="button" data-edit-catalog="${v.id}">Editar ficha</button></div></article>`).join('') : '<div class="empty-state">No hay vehículos.</div>';
    renderPagination('catalogPagination', catalogPage, totalPages, 'catalog-page');
  }

  function slugifyCatalog(value) {
    return String(value || 'vehiculo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehiculo';
  }

  function openCatalogForm(id='') {
    const v = vehicles.find(x=>String(x.id)===String(id));
    $('#catalogVehicleId').value = v?.id || '';
    $('#catalogInternalName').value = v?.nombre || '';
    $('#catalogImageFile').value = '';
    $('#catalogGalleryFiles').value = '';
    $('#catalogVideoFile').value = '';
    $('#catalogInternalPrice').value = v ? (v.precio ?? '') : '';
    $('#catalogBrand').value = v?.public_brand || '';
    $('#catalogModel').value = v?.public_model || '';
    $('#catalogVersion').value = v?.public_version || '';
    $('#catalogClass').value = v?.public_class || 'minibus';
    $('#catalogEngine').value = v?.public_engine || '';
    $('#catalogStatus').value = v?.public_status || 'nuevo';
    $('#catalogVariant').value = v?.public_variant || '';
    $('#catalogImage').value = v?.public_image_url || '';
    $('#catalogDescription').value = v?.public_description || '';
    $('#catalogFeatured').checked = Boolean(v?.public_featured);
    $('#catalogOffer').checked = Boolean(v?.public_offer);
    $('#catalogModalTitle').textContent = v ? 'Editar ficha de vehículo' : 'Nueva ficha de vehículo';
    openModal('catalogModal');
  }

  async function saveCatalog(event) {
    event.preventDefault();
    const id = $('#catalogVehicleId').value;
    const existing = vehicles.find(v => String(v.id) === String(id));
    let publicGallery = Array.isArray(existing?.public_gallery_urls) ? [...existing.public_gallery_urls] : [];
    let publicVideo = existing?.public_video_url || null;
    const mainFile = $('#catalogImageFile').files?.[0];
    const galleryFiles = [...($('#catalogGalleryFiles').files || [])];
    const videoFile = $('#catalogVideoFile').files?.[0];
    try {
      if (mainFile) {
        const uploadedMain = await uploadCatalogFile(mainFile, 'vehiculos');
        if (uploadedMain) $('#catalogImage').value = uploadedMain;
      }
      if (galleryFiles.length) {
        const uploadedGallery = (await Promise.all(galleryFiles.map(file => uploadCatalogFile(file, 'vehiculos/gallery')))).filter(Boolean);
        publicGallery = [...publicGallery, ...uploadedGallery];
      }
      if (videoFile) {
        publicVideo = await uploadCatalogFile(videoFile, 'vehiculos/video');
      }
    } catch (uploadError) {
      console.error('[Autosale] carga de archivos:', uploadError);
      return showToast(`No se pudo subir un archivo: ${uploadError.message || 'error'}`, 'error');
    }

    const internalName = $('#catalogInternalName').value.trim() || [$('#catalogBrand').value.trim(), $('#catalogModel').value.trim(), $('#catalogVersion').value.trim()].filter(Boolean).join(' ');
    const slugBase = slugifyCatalog([$('#catalogBrand').value, $('#catalogModel').value, $('#catalogVersion').value].filter(Boolean).join(' ') || internalName);
    const publicPayload = {
      public_brand: $('#catalogBrand').value.trim(),
      public_model: $('#catalogModel').value.trim(),
      public_version: $('#catalogVersion').value.trim(),
      public_class: $('#catalogClass').value,
      public_engine: $('#catalogEngine').value.trim(),
      public_status: $('#catalogStatus').value,
      public_variant: $('#catalogVariant').value.trim(),
      public_image_url: $('#catalogImage').value.trim() || null,
      public_description: $('#catalogDescription').value.trim(),
      public_gallery_urls: publicGallery,
      public_video_url: publicVideo,
      public_slug: existing?.public_slug || `${slugBase}-${crypto.randomUUID().slice(0, 6)}`,
      public_published: true,
      public_featured: $('#catalogFeatured').checked,
      public_offer: $('#catalogOffer').checked,
      public_new: false
    };
    if (!publicPayload.public_brand) return showToast('La marca es obligatoria.', 'error');

    let result;
    if (id) {
      result = await db.from('vehiculos').update(publicPayload).eq('id', id);
    } else {
      const insertPayload = {
        nombre: internalName,
        precio: Number($('#catalogInternalPrice').value || 0),
        precio_bs_manual: null,
        precio_bs_modo: 'tipo_cambio',
        ...publicPayload
      };
      result = await db.from('vehiculos').insert(insertPayload);
    }
    if (result.error) return showToast(result.error.message, 'error');
    closeModal('catalogModal'); await loadVehicles(); showToast(id ? 'Ficha web actualizada y publicada.' : 'Vehículo publicado en la web.');
  }

  // --------------------------------------------------------------
  // Búsqueda global
  // --------------------------------------------------------------
  function renderGlobalSearch() {
    const input=$('#globalSearch'), box=$('#globalSearchResults'); if(!input||!box)return;
    const q=normalizeText(input.value.trim()); if(!q){box.hidden=true;box.innerHTML='';return;}
    const result=[];
    clients.filter(c=>normalizeText(`${c.nombre_completo} ${c.celular} ${c.vehiculo?.nombre||''}`).includes(q)).slice(0,5).forEach(c=>result.push({kind:'client',id:c.id,title:c.nombre_completo,meta:`Cliente · ${c.celular}`}));
    vehicles.filter(v=>normalizeText(v.nombre).includes(q)).slice(0,4).forEach(v=>result.push({kind:'vehicle',id:v.id,title:v.nombre,meta:`Vehículo · ${moneyUSD(v.precio)}`}));
    quotesSummary.filter(x=>String(x.numero).includes(input.value.trim())||normalizeText(x.vehiculo_nombre||'').includes(q)).slice(0,4).forEach(x=>{const c=clients.find(c=>c.id===x.cliente_id);result.push({kind:'quote',id:x.id,title:`Cotización #${x.numero}`,meta:`${c?.nombre_completo||'Sin cliente'} · ${x.vehiculo_nombre||'Sin vehículo'}`});});
    box.innerHTML=result.length?result.slice(0,10).map(r=>`<button type="button" class="global-search__result" data-global-kind="${r.kind}" data-global-id="${r.id}"><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.meta)}</span></button>`).join(''):'<div class="global-search__empty">Sin resultados.</div>';
    box.hidden=false;
  }

  async function handleGlobalResult(kind,id) {
    $('#globalSearch').value=''; $('#globalSearchResults').hidden=true;
    if(kind==='client'){navigateToView('clientesView');await openClient(id);}
    if(kind==='vehicle'){navigateToView('cotizadorView');addVehicleToQuote(id);}
    if(kind==='quote'){await loadQuoteForEdit(id);}
  }

  // --------------------------------------------------------------
  // Eventos
  // --------------------------------------------------------------
  function initEvents() {
    $('#loginForm').addEventListener('submit', login);
    $('#registerForm').addEventListener('submit', registerAdvisor);
    $('#showLoginBtn').addEventListener('click',()=>switchAuth('login')); $('#showRegisterBtn').addEventListener('click',()=>switchAuth('register'));
    $('#loginCredentialType').addEventListener('change',()=>syncCredentialInput('loginCredentialType','loginPassword','loginSecretLabel')); $('#registerCredentialType').addEventListener('change',()=>syncCredentialInput('registerCredentialType','registerSecret','registerSecretLabel'));
    $('#passkeyLoginBtn').addEventListener('click', loginWithPasskey);
    $('#logoutBtn').addEventListener('click', logout);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#quickAccessBtn').addEventListener('click', openQuickAccessModal);
    $('#passwordChangeForm').addEventListener('submit', completeTemporaryPassword);
    $('#registerPasskeyBtn').addEventListener('click', registerPasskey);
    $('#accountProfileForm').addEventListener('submit',saveAccountProfile); $('#accountCredentialForm').addEventListener('submit',saveAccountCredential); $('#accountCredentialType').addEventListener('change',()=>syncCredentialInput('accountCredentialType','accountSecret','accountSecretLabel')); $('#accountPasskeyBtn').addEventListener('click',openQuickAccessModal); $('#accountLogoutBtn').addEventListener('click',logout);
    $('#confirmCancelBtn').addEventListener('click',()=>resolveConfirm(false)); $('#confirmAcceptBtn').addEventListener('click',()=>resolveConfirm(true));

    $('#globalSearch').addEventListener('input',renderGlobalSearch);
    $('#globalSearchClear').addEventListener('click',()=>{$('#globalSearch').value='';$('#globalSearchResults').hidden=true;});
    $('#globalSearchResults').addEventListener('click',e=>{const btn=e.target.closest('[data-global-kind]');if(btn)handleGlobalResult(btn.dataset.globalKind,btn.dataset.globalId);});
    document.addEventListener('click',e=>{if(!e.target.closest('#globalSearchWrap'))$('#globalSearchResults').hidden=true;});

    $('#buscarVehiculo').addEventListener('input', () => { vehicleCandidateId=''; $('#addVehicleQuoteBtn').disabled=true; renderVehicleSearch(); });
    $('#buscarVehiculo').addEventListener('focus', renderVehicleSearch);
    $('#buscarVehiculo').addEventListener('keydown', e => { if (e.key==='Escape') $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible'); });
    $('#resultadosVehiculos').addEventListener('click', e => { const btn=e.target.closest('[data-id]'); if(btn) chooseVehicleCandidate(btn.dataset.id); });
    $('#limpiarVehiculo').addEventListener('click', clearVehicleSearch);
    $('#addVehicleQuoteBtn').addEventListener('click',()=>addVehicleToQuote());
    $('#quoteVehicleTabs').addEventListener('click',e=>{
      const remove=e.target.closest('[data-remove-quote-tab]'); if(remove){e.preventDefault();e.stopPropagation();removeQuoteTab(remove.dataset.removeQuoteTab);return;}
      const tab=e.target.closest('[data-quote-tab]'); if(tab)activateQuoteTab(tab.dataset.quoteTab);
    });

    $('#tc').addEventListener('input', () => {
      if(priceBsModeQuote!=='manual') $('#precioBs').value=Number($('#precio').value||0)?Math.round(Number($('#precio').value||0)*currentTc()):'';
      if(financeMode==='initial') syncCurrencyPair(financeSourceCurrency==='usd'?'#inicial':'#inicialBs',financeSourceCurrency==='usd'?'#inicialBs':'#inicial',financeSourceCurrency);
      if(financeMode==='amount') syncCurrencyPair(financeSourceCurrency==='usd'?'#monto':'#montoBs',financeSourceCurrency==='usd'?'#montoBs':'#monto',financeSourceCurrency);
      recomputeFinanceForPriceChange();
    });
    $('#precio').addEventListener('input', updateFinanceFromPrice);
    $('#precioBs').addEventListener('input', () => { priceBsModeQuote='manual'; recomputeFinanceForPriceChange(); });
    $('#inicial').addEventListener('input', syncFromInitialUsd); $('#inicialBs').addEventListener('input', syncFromInitialBs);
    $('#monto').addEventListener('input', syncFromAmountUsd); $('#montoBs').addEventListener('input', syncFromAmountBs);
    $('#tasa').addEventListener('input',()=>{updateChipGroup('chips-tasa',Number($('#tasa').value), 'val');calc();persistQuoteDraft();});
    $('#anios').addEventListener('input',()=>{updateChipGroup('chips-anios',Number($('#anios').value), 'val');calc();persistQuoteDraft();});
    $('#quotePurchaseMode').addEventListener('change',changeQuotePurchaseMode);
    $('#chips-pct-inicial').addEventListener('click', e => { const chip=e.target.closest('[data-pct]'); if(chip) selectInitialPct(Number(chip.dataset.pct)); });
    $('#chips-tasa').addEventListener('click', e => { const chip=e.target.closest('[data-val]'); if(chip) selectChip('tasa', Number(chip.dataset.val)); });
    $('#chips-anios').addEventListener('click', e => { const chip=e.target.closest('[data-val]'); if(chip) selectChip('anios', Number(chip.dataset.val)); });
    $('#newQuoteBtn').addEventListener('click', resetQuote); $('#shareQuoteBtn').addEventListener('click', shareQuote); $('#saveQuoteBtn').addEventListener('click', saveQuote);
    $('#quoteClientSelect').addEventListener('change', e => {
      selectedClientId=e.target.value;
      const c=clients.find(x=>x.id===selectedClientId);
      if(c?.modo_compra){
        $('#quotePurchaseMode').value=c.modo_compra;
        changeQuotePurchaseMode();
      } else {
        persistQuoteDraft();
      }
    });
    $('#quickClientBtn').addEventListener('click',()=>{clientReturnToQuote=true;openClient();});

    $('#newClientBtn').addEventListener('click',()=>{clientReturnToQuote=false;openClient();});
    ['clientSearch','clientStatusFilter','clientModeFilter','clientTradeFilter'].forEach(id=>{const el=$(`#${id}`);if(el)el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>{clientPage=1;renderClients();});});
    $('#clientsPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-client-page]');if(btn){clientPage=Number(btn.dataset.clientPage)||1;renderClients();}});
    $('#clientsList').addEventListener('click', e => {
      const edit=e.target.closest('[data-client-edit]'),history=e.target.closest('[data-client-history]'),exportBtn=e.target.closest('[data-client-export]'),follow=e.target.closest('[data-client-new-followup]'),quote=e.target.closest('[data-client-quote]');
      if(edit)openClient(edit.dataset.clientEdit); if(history)openClientHistory(history.dataset.clientHistory); if(exportBtn)exportClientPdf(exportBtn.dataset.clientExport); if(follow)openFollowup(follow.dataset.clientNewFollowup); if(quote)startQuoteForClient(quote.dataset.clientQuote);
    });
    $('#clientForm').addEventListener('input',persistClientDraft); $('#clientForm').addEventListener('change',persistClientDraft);
    $('#clientStatus').addEventListener('change',syncClientConditionalFields);
    $('#clientHasTradein').addEventListener('change',e=>{const on=e.target.checked;$('#tradeinFields').hidden=!on;if(!on)clearTradeinFields();persistClientDraft();});
    $('#clientForm').addEventListener('submit',saveClient); $('#deleteClientBtn').addEventListener('click',deleteClient);

    $('#followupSearch').addEventListener('input',()=>{followupPage=1;renderFollowups();}); $('#followupFilter').addEventListener('change',()=>{followupPage=1;renderFollowups();});
    $('#followupsPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-followup-page]');if(btn){followupPage=Number(btn.dataset.followupPage)||1;renderFollowups();}});
    $('#newFollowupBtn').addEventListener('click',()=>openFollowup());
    $('#followupsList').addEventListener('click', async e => {
      const complete=e.target.closest('[data-followup-complete]'),edit=e.target.closest('[data-followup-edit]'),del=e.target.closest('[data-followup-delete]');
      if(complete)await toggleFollowup(complete.dataset.followupComplete); if(edit)await openFollowup('',edit.dataset.followupEdit); if(del)await deleteFollowup(del.dataset.followupDelete,del.dataset.followupClient);
    });
    $('#followupForm').addEventListener('submit',saveFollowup);
    $('#clientHistoryModal').addEventListener('click',async e=>{const editQ=e.target.closest('[data-quote-edit]'),delQ=e.target.closest('[data-quote-delete]'),editF=e.target.closest('[data-followup-edit]'),delF=e.target.closest('[data-followup-delete]');if(editQ)await loadQuoteForEdit(editQ.dataset.quoteEdit);if(delQ)await deleteQuote(delQ.dataset.quoteDelete);if(editF){closeModal('clientHistoryModal');await openFollowup(historyClientId,editF.dataset.followupEdit);}if(delF)await deleteFollowup(delF.dataset.followupDelete,delF.dataset.followupClient||historyClientId);});
    $('#historyQuotesPagination').addEventListener('click',e=>{const b=e.target.closest('[data-history-quote-page]');if(b){historyQuotePage=Number(b.dataset.historyQuotePage)||1;renderClientHistory();}}); $('#historyFollowupsPagination').addEventListener('click',e=>{const b=e.target.closest('[data-history-followup-page]');if(b){historyFollowupPage=Number(b.dataset.historyFollowupPage)||1;renderClientHistory();}});

    $('#settingsForm').addEventListener('submit',saveSettings); $('#vehicleForm').addEventListener('submit',saveVehicle); $('#catalogForm').addEventListener('submit',saveCatalog);
    $('#openVehicleAdminBtn').addEventListener('click',()=>openVehicleAdmin()); $('#cancelVehicleBtn').addEventListener('click',resetVehicleForm);
    $('#vehicleAdminSearch').addEventListener('input',()=>{vehicleAdminPage=1;renderVehicleAdmin();});
    $('#vehicleAdminPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-vehicle-page]');if(btn){vehicleAdminPage=Number(btn.dataset.vehiclePage)||1;renderVehicleAdmin();}});
    $('#adminVehicleList').addEventListener('click',e=>{const edit=e.target.closest('[data-edit-vehicle]'),del=e.target.closest('[data-delete-vehicle]');if(edit)openVehicleAdmin(edit.dataset.editVehicle);if(del)deleteVehicle(del.dataset.deleteVehicle);});
    $('#catalogSearch').addEventListener('input',()=>{catalogPage=1;renderCatalogAdmin();}); $('#newCatalogVehicleBtn').addEventListener('click',()=>openCatalogForm());
    $('#catalogPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-catalog-page]');if(btn){catalogPage=Number(btn.dataset.catalogPage)||1;renderCatalogAdmin();}});
    $('#catalogAdminList').addEventListener('click',e=>{const btn=e.target.closest('[data-edit-catalog]');if(btn)openCatalogForm(btn.dataset.editCatalog);});

    $('#advisorsList').addEventListener('click',async e=>{const view=e.target.closest('[data-advisor-view]'),keys=e.target.closest('[data-advisor-passkeys]'),approve=e.target.closest('[data-advisor-approve]'),toggle=e.target.closest('[data-advisor-toggle]'),del=e.target.closest('[data-advisor-delete]');if(view)openAdvisorDetail(view.dataset.advisorView);if(keys)await revokeAdvisorPasskeys(keys.dataset.advisorPasskeys);if(approve)await setAdvisorApproval(approve.dataset.advisorApprove,'approved');if(toggle)await toggleAdvisorActive(toggle.dataset.advisorToggle,toggle.dataset.active==='1');if(del)await deleteAdvisor(del.dataset.advisorDelete);});
    $('#advisorPendingList').addEventListener('click',async e=>{const approve=e.target.closest('[data-advisor-approve]'),reject=e.target.closest('[data-advisor-reject]');if(approve)await setAdvisorApproval(approve.dataset.advisorApprove,'approved');if(reject)await setAdvisorApproval(reject.dataset.advisorReject,'rejected');});
    $('#advisorsPagination').addEventListener('click',e=>{const b=e.target.closest('[data-advisor-page-main]');if(b){advisorPage=Number(b.dataset.advisorPageMain)||1;renderAdvisors();}});
    $('#advisorActivityList').addEventListener('click',e=>{const view=e.target.closest('[data-advisor-view]');if(view)openAdvisorDetail(view.dataset.advisorView);});
    $('#advisorDetailSearch').addEventListener('input',()=>{advisorDetailPage=1;renderAdvisorDetail(advisorDetailId);});
    $('#advisorDetailPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-advisor-page]');if(btn){advisorDetailPage=Number(btn.dataset.advisorPage)||1;renderAdvisorDetail(advisorDetailId);}});
    $('#advisorDetailClients').addEventListener('click',async e=>{const edit=e.target.closest('[data-admin-client-edit]'),history=e.target.closest('[data-admin-client-history]'),exportBtn=e.target.closest('[data-admin-client-export]');if(edit){closeModal('advisorDetailModal');await openClient(edit.dataset.adminClientEdit);}if(history){closeModal('advisorDetailModal');await openClientHistory(history.dataset.adminClientHistory);}if(exportBtn)await exportClientPdf(exportBtn.dataset.adminClientExport);});
    $('#bulkReassignBtn').addEventListener('click',bulkReassignClients);
    $$('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#confirmModal')?.hidden) { resolveConfirm(false); return; }
    const top = [...document.querySelectorAll('.modal:not([hidden])')].pop();
    if (top && !top.classList.contains('modal--critical')) closeModal(top.id);
  });

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
      registration.update().catch(()=>{});
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        if(sessionStorage.getItem('autosale-sw-reloaded')==='1')return;
        sessionStorage.setItem('autosale-sw-reloaded','1');
        window.location.reload();
      });
    } catch(error) { console.warn('[AutoSale] service worker:',error); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initTheme(); initEvents(); initTabs(); syncCredentialInput('loginCredentialType','loginPassword','loginSecretLabel'); syncCredentialInput('registerCredentialType','registerSecret','registerSecretLabel'); showSplash();
    updateChipGroup('chips-tasa', Number($('#tasa').value || 16), 'val');
    updateChipGroup('chips-anios', Number($('#anios').value || 5), 'val');
    updateChipGroup('chips-pct-inicial', 0, 'pct');
    calc(); registerServiceWorker(); await bootAuth();
  });
})();
