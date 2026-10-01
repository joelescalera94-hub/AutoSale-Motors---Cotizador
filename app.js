/* ================================================================
   AUTOSALE MOTORS · COTIZADOR + CRM · APP V2.4
   ================================================================ */
(() => {
  'use strict';

  const cfg = window.AUTOSALE_SUPABASE || {};
  const SUPABASE_URL = String(cfg.url || '').replace(/\/$/, '');
  const SUPABASE_KEY = String(cfg.anonKey || '');
  const hasSupabase = Boolean(window.supabase?.createClient && SUPABASE_URL && SUPABASE_KEY);
  const db = hasSupabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  }) : null;

  const LOCAL_VEHICLES_KEY = 'autosale_vehiculos_v2_cache';
  const SETTINGS_KEY = 'autosale_settings_v1';
  const INSURANCE_DEFAULT = 1;

  let session = null;
  let profile = null;
  let vehicles = [];
  let clients = [];
  let advisors = [];
  let followups = [];
  let quotesSummary = [];
  let adminQuotes = [];
  let auditRows = [];
  let trashItems = { clients: [], quotes: [], followups: [] };
  let selectedVehicle = null;
  let selectedClientId = '';
  let historyClientId = '';
  let selectedEditingQuoteId = '';
  let initialPct = 0;
  let financeMode = 'initial';
  let financeSourceCurrency = 'usd';
  let priceBsModeQuote = 'tipo_cambio';
  let realtimeChannel = null;
  let settings = { tipo_cambio: 6.96, tasa_interes_default: 16, seguro_desgravamen: INSURANCE_DEFAULT };
  let lastMonthlyUsd = 0;
  let lastMonthlyBs = 0;
  let clientPage = 1;
  let followupPage = 1;
  let clientReturnToQuote = false;
  const CLIENTS_PER_PAGE = 20;
  const FOLLOWUPS_PER_PAGE = 20;
  const QUOTE_DRAFT_KEY = 'autosale_quote_draft_v24';
  const CLIENT_DRAFT_KEY = 'autosale_client_draft_v24';

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
    return ({contado:'Contado',garante_personal:'Garante personal',hipotecario_vehicular:'Hipotecario vehicular',hipotecado_inmueble:'Hipotecado de inmueble'})[value] || 'Modo sin definir';
  }
  const CLIENT_ORIGINS = ['Facebook','TikTok','Recomendación de un cliente anterior','Visita por concesionaria','Web'];
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
  function navigateToView(viewId) {
    $$('.app-tab').forEach(item => item.classList.toggle('app-tab--active', item.dataset.view === viewId));
    $$('.app-view').forEach(view => view.classList.toggle('app-view--active', view.id === viewId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    if (!db) {
      $('#loginMessage').textContent = 'Supabase no está configurado.';
      return;
    }
    const { data } = await db.auth.getSession();
    if (data.session) await setSession(data.session); else showLoggedOut();
    db.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession) await setSession(newSession);
      else showLoggedOut();
    });
  }

  async function login(event) {
    event.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const btn = $('#loginBtn');
    $('#loginMessage').textContent = 'Ingresando…';
    btn.disabled = true;
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await setSession(data.session);
      $('#loginMessage').textContent = '';
    } catch (error) {
      $('#loginMessage').textContent = error.message || 'No se pudo iniciar sesión.';
    } finally { btn.disabled = false; }
  }

  function setAuthUI(isLoggedIn) {
    const authView = $('#authView');
    const appView = $('#appView');
    document.body.classList.toggle('app-logged-in', isLoggedIn);
    if (authView) {
      authView.hidden = isLoggedIn;
      authView.style.display = isLoggedIn ? 'none' : 'grid';
      authView.setAttribute('aria-hidden', isLoggedIn ? 'true' : 'false');
    }
    if (appView) {
      appView.hidden = !isLoggedIn;
      appView.style.display = isLoggedIn ? 'block' : 'none';
      appView.setAttribute('aria-hidden', isLoggedIn ? 'false' : 'true');
    }
  }

  async function setSession(nextSession) {
    session = nextSession;
    if (!session?.user) return showLoggedOut();
    const { data, error } = await db.from('profiles').select('id,full_name,role,active').eq('id', session.user.id).single();
    if (error) {
      showToast('No se pudo cargar tu perfil.', 'error');
      await db.auth.signOut();
      return;
    }
    if (!data.active) {
      showToast('Tu cuenta está desactivada.', 'error');
      await db.auth.signOut();
      return;
    }
    profile = data;
    setAuthUI(true);
    $('#currentUserName').textContent = data.full_name || session.user.email;
    $('#currentUserRole').textContent = data.role === 'admin' ? 'Administrador' : 'Asesor';
    $$('.app-tab--admin').forEach((tab) => { tab.hidden = data.role !== 'admin'; });
    await loadAllData();
    initRealtime();
  }

  function showLoggedOut() {
    session = null; profile = null;
    if (realtimeChannel) { db?.removeChannel(realtimeChannel); realtimeChannel = null; }
    setAuthUI(false);
  }

  async function logout() { await db.auth.signOut(); }

  // --------------------------------------------------------------
  // Datos base
  // --------------------------------------------------------------
  async function loadSettings() {
    if (!db) return;
    const { data } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (data) settings = data;
    $('#tc').value = settings.tipo_cambio;
    $('#tasa').value = settings.tasa_interes_default;
    updateChipGroup('chips-tasa', Number(settings.tasa_interes_default || 16), 'val');
    updateChipGroup('chips-anios', Number($('#anios').value || 5), 'val');
    updateChipGroup('chips-pct-inicial', Number(initialPct ?? 0), 'pct');
  }

  async function loadVehicles() {
    if (!db) return;
    const { data, error } = await db.from('vehiculos').select('*').order('nombre');
    if (error) { console.error('[Autosale] vehículos:', error); return; }
    vehicles = data || [];
    try { localStorage.setItem(LOCAL_VEHICLES_KEY, JSON.stringify(vehicles)); } catch (_) {}
    renderVehicleSearch(); renderVehicleAdmin(); renderCatalogAdmin(); populateVehicleSelects(); updateSelectedVehicleAfterSync(); renderGlobalSearch();
  }

  async function loadClients() {
    if (!db) return;
    let query = db.from('clientes').select('*, vehiculo:vehiculos(id,nombre), permuta:cliente_permutas(id,estado_revision,marca,modelo)').is('archived_at', null).order('updated_at', { ascending: false });
    if (profile.role !== 'admin') query = query.eq('asesor_id', session.user.id);
    const { data, error } = await query;
    if (error) { console.error('[Autosale] clientes:', error); return; }
    clients = data || [];
    renderClients(); renderClientSelect(); populateFollowupClients(); populateClientAdvisorFilter(); if (profile.role === 'admin') renderDashboard(); renderGlobalSearch();
  }

  async function loadAdvisors() {
    if (profile.role !== 'admin') return;
    const { data, error } = await db.from('profiles').select('id,full_name,role,active,created_at').eq('role', 'asesor').order('full_name');
    if (!error) advisors = data || [];
    renderAdvisors(); populateAdvisorSelect(); populateClientAdvisorFilter(); populateReassignSelects();
  }

  async function loadFollowups() {
    if (!db) return;
    let query = db.from('seguimientos').select('*, cliente:clientes(id,nombre_completo,celular,estado), asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)').is('deleted_at', null).order('programado_para', { ascending: true, nullsFirst: false });
    if (profile.role !== 'admin') query = query.eq('asesor_id', session.user.id);
    const { data, error } = await query;
    if (!error) followups = data || [];
    renderFollowups(); renderClients(); if (profile.role === 'admin') renderDashboard();
  }

  async function loadQuotesSummary() {
    if (!db) return;
    let query = db.from('cotizaciones').select('id,numero,cliente_id,asesor_id,vehiculo_id,vehiculo_nombre,precio_usd,precio_bs,cuota_inicial_usd,cuota_inicial_bs,monto_financiado_usd,monto_financiado_bs,tasa_interes,seguro_desgravamen,plazo_anios,cuota_mensual_usd,cuota_mensual_bs,created_at,updated_at').is('deleted_at', null).order('created_at', { ascending: false });
    if (profile.role !== 'admin') query = query.eq('asesor_id', session.user.id);
    const { data, error } = await query;
    if (error) { console.warn('[Autosale] cotizaciones:', error.message); quotesSummary = []; adminQuotes = []; return; }
    quotesSummary = data || [];
    adminQuotes = profile.role === 'admin' ? quotesSummary : [];
    renderClients(); renderGlobalSearch(); if (profile.role === 'admin') renderDashboard();
  }

  async function loadAudit() {
    if (!db || profile?.role !== 'admin') { auditRows = []; return; }
    const { data, error } = await db.from('auditoria').select('id,accion,tabla,registro_id,created_at,actor:profiles!auditoria_actor_id_fkey(full_name)').order('created_at', { ascending:false }).limit(30);
    if (!error) auditRows = data || [];
    renderAudit();
  }

  async function loadTrash() {
    if (!db || profile?.role !== 'admin') return;
    const [c,q,f] = await Promise.all([
      db.from('clientes').select('id,nombre_completo,celular,archived_at').not('archived_at','is',null).order('archived_at',{ascending:false}).limit(30),
      db.from('cotizaciones').select('id,numero,vehiculo_nombre,deleted_at').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(30),
      db.from('seguimientos').select('id,tipo,cliente_id,deleted_at,cliente:clientes(nombre_completo)').not('deleted_at','is',null).order('deleted_at',{ascending:false}).limit(30)
    ]);
    trashItems = { clients:c.data||[], quotes:q.data||[], followups:f.data||[] };
    renderTrash();
  }

  async function loadAllData() {
    await Promise.all([loadSettings(), loadVehicles(), loadClients(), loadFollowups(), loadAdvisors(), loadQuotesSummary(), loadAudit(), loadTrash()]);
    renderDashboard();
    restoreQuoteDraft();
  }

  function initRealtime() {
    if (realtimeChannel || !db || !session) return;
    let timer;
    const refreshCrm = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => { await Promise.all([loadClients(), loadFollowups(), loadQuotesSummary()]); if (profile?.role === 'admin') { await Promise.all([loadAudit(), loadTrash()]); } }, 250);
    };
    realtimeChannel = db.channel(`autosale-live-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehiculos' }, async () => { await loadVehicles(); showToast('Catálogo actualizado.'); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, refreshCrm)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seguimientos' }, refreshCrm)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cotizaciones' }, refreshCrm)
      .subscribe();
  }

  // --------------------------------------------------------------
  // Navegación
  // --------------------------------------------------------------
  function initTabs() {
    $$('.app-tab').forEach((tab) => tab.addEventListener('click', () => {
      $$('.app-tab').forEach((item) => item.classList.remove('app-tab--active'));
      $$('.app-view').forEach((view) => view.classList.remove('app-view--active'));
      tab.classList.add('app-tab--active');
      const view = document.getElementById(tab.dataset.view);
      if (view) view.classList.add('app-view--active');
    }));
  }

  function closeModal(id) { const modal = document.getElementById(id); if (modal) { modal.hidden = true; document.body.classList.remove('modal-open'); } }
  function openModal(id) { const modal = document.getElementById(id); if (modal) { modal.hidden = false; document.body.classList.add('modal-open'); } }

  // --------------------------------------------------------------
  // Vehículos / cotizador
  // --------------------------------------------------------------
  function vehicleBsPrice(v) {
    const tc = Number($('#tc')?.value || settings.tipo_cambio || 0);
    if (v?.precio_bs_modo === 'manual' && Number(v.precio_bs_manual) > 0) return Number(v.precio_bs_manual);
    return Number(v?.precio || 0) * tc;
  }

  function renderVehicleSearch() {
    const input = $('#buscarVehiculo');
    const container = $('#resultadosVehiculos');
    if (!input || !container) return;
    const q = normalizeText(input.value.trim());
    if (document.activeElement !== input) return container.classList.remove('vehicle-search__results--visible');
    if (!q) { container.innerHTML = ''; container.classList.remove('vehicle-search__results--visible'); return; }
    const results = vehicles.filter(v => normalizeText(v.nombre).includes(q)).slice(0, 12);
    container.innerHTML = results.length ? results.map(v => `<button type="button" class="vehicle-search__result" data-id="${escapeHtml(v.id)}" role="option"><span class="vehicle-search__result-name">${escapeHtml(v.nombre)}</span><span class="vehicle-search__result-price">${moneyUSD(v.precio)}</span></button>`).join('') : '<div class="vehicle-search__empty">No se encontraron vehículos.</div>';
    container.classList.add('vehicle-search__results--visible');
  }

  function selectVehicle(id) {
    const vehicle = vehicles.find(v => String(v.id) === String(id));
    if (!vehicle) return;
    selectedVehicle = { ...vehicle };
    $('#buscarVehiculo').value = vehicle.nombre;
    $('#precio').value = Number(vehicle.precio || 0) || '';
    const bs = vehicleBsPrice(vehicle);
    $('#precioBs').value = Math.round(bs) || '';
    priceBsModeQuote = vehicle.precio_bs_modo === 'manual' ? 'manual' : 'tipo_cambio';
    recomputeFinanceForPriceChange();
    updateSelectedVehicleUI();
    $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible');
    persistQuoteDraft();
  }

  function updateSelectedVehicleUI() {
    const box = $('#vehiculoSeleccionado');
    if (!box) return;
    if (!selectedVehicle) { box.hidden = true; return; }
    $('#vehiculoSeleccionadoNombre').textContent = `${selectedVehicle.nombre} · ${moneyUSD(selectedVehicle.precio)}`;
    box.hidden = false;
  }

  function updateSelectedVehicleAfterSync() {
    if (!selectedVehicle) return;
    const updated = vehicles.find(v => String(v.id) === String(selectedVehicle.id));
    if (!updated) return clearSelectedVehicle();
    selectedVehicle = { ...updated };
    updateSelectedVehicleUI();
  }

  function clearSelectedVehicle() {
    selectedVehicle = null;
    $('#buscarVehiculo').value = '';
    $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible');
    $('#vehiculoSeleccionado').hidden = true;
    persistQuoteDraft();
  }

  function currentTc() { return Number($('#tc').value || settings.tipo_cambio || 0); }
  function effectivePriceBs() { return priceBsModeQuote === 'manual' ? Number($('#precioBs').value || 0) : Number($('#precio').value || 0) * currentTc(); }
  function clamp(value, min, max) { return Math.min(Math.max(Number(value || 0), min), max); }

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
    if (financeMode === 'percent') {
      syncFinanceByPct(initialPct ?? 0, false);
      return;
    }
    if (financeMode === 'amount') {
      const amountUsd = Number($('#monto').value || 0);
      const amountBs = Number($('#montoBs').value || 0);
      if (priceUsd > 0) $('#inicial').value = Math.max(0, Math.round(priceUsd - amountUsd)) || '';
      if (priceBs > 0) $('#inicialBs').value = Math.max(0, Math.round(priceBs - amountBs)) || '';
      updateInitialChipFromManual();
      calc(); persistQuoteDraft(); return;
    }
    const initialUsd = Number($('#inicial').value || 0);
    const initialBs = Number($('#inicialBs').value || 0);
    if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - initialUsd)) || '';
    if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - initialBs)) || '';
    updateInitialChipFromManual();
    calc(); persistQuoteDraft();
  }

  function syncFinanceByPct(pct, persist = true) {
    const safePct = clamp(pct, 0, 100);
    const priceUsd = Number($('#precio').value || 0);
    const priceBs = effectivePriceBs();
    initialPct = safePct;
    financeMode = 'percent';
    $('#inicial').value = priceUsd > 0 ? Math.round(priceUsd * safePct / 100) || '' : '';
    $('#inicialBs').value = priceBs > 0 ? Math.round(priceBs * safePct / 100) || '' : '';
    $('#monto').value = priceUsd > 0 ? Math.round(Math.max(0, priceUsd - Number($('#inicial').value || 0))) || '' : $('#monto').value;
    $('#montoBs').value = priceBs > 0 ? Math.round(Math.max(0, priceBs - Number($('#inicialBs').value || 0))) || '' : $('#montoBs').value;
    updateChipGroup('chips-pct-inicial', safePct, 'pct');
    calc(); if (persist) persistQuoteDraft();
  }

  function syncFromInitialUsd() {
    financeMode = 'initial'; financeSourceCurrency = 'usd'; initialPct = null;
    syncCurrencyPair('#inicial', '#inicialBs', 'usd');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    const initialUsd = Number($('#inicial').value || 0), initialBs = Number($('#inicialBs').value || 0);
    if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - initialUsd)) || '';
    if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - initialBs)) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFromInitialBs() {
    financeMode = 'initial'; financeSourceCurrency = 'bs'; initialPct = null;
    syncCurrencyPair('#inicialBs', '#inicial', 'bs');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    const initialUsd = Number($('#inicial').value || 0), initialBs = Number($('#inicialBs').value || 0);
    if (priceUsd > 0) $('#monto').value = Math.max(0, Math.round(priceUsd - initialUsd)) || '';
    if (priceBs > 0) $('#montoBs').value = Math.max(0, Math.round(priceBs - initialBs)) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFromAmountUsd() {
    financeMode = 'amount'; financeSourceCurrency = 'usd'; initialPct = null;
    syncCurrencyPair('#monto', '#montoBs', 'usd');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    const amountUsd = Number($('#monto').value || 0), amountBs = Number($('#montoBs').value || 0);
    if (priceUsd > 0) $('#inicial').value = Math.max(0, Math.round(priceUsd - amountUsd)) || '';
    if (priceBs > 0) $('#inicialBs').value = Math.max(0, Math.round(priceBs - amountBs)) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function syncFromAmountBs() {
    financeMode = 'amount'; financeSourceCurrency = 'bs'; initialPct = null;
    syncCurrencyPair('#montoBs', '#monto', 'bs');
    const priceUsd = Number($('#precio').value || 0), priceBs = effectivePriceBs();
    const amountUsd = Number($('#monto').value || 0), amountBs = Number($('#montoBs').value || 0);
    if (priceUsd > 0) $('#inicial').value = Math.max(0, Math.round(priceUsd - amountUsd)) || '';
    if (priceBs > 0) $('#inicialBs').value = Math.max(0, Math.round(priceBs - amountBs)) || '';
    updateInitialChipFromManual(); calc(); persistQuoteDraft();
  }

  function updateFinanceFromPrice() {
    const price = Number($('#precio').value || 0);
    if (priceBsModeQuote !== 'manual') $('#precioBs').value = price ? Math.round(price * currentTc()) : '';
    recomputeFinanceForPriceChange();
  }

  function payment(principal, monthlyRate, periods) {
    const p = Number(principal || 0);
    if (p <= 0 || periods <= 0) return 0;
    if (monthlyRate <= 0) return p / periods;
    const pow = Math.pow(1 + monthlyRate, periods);
    return p * (monthlyRate * pow) / (pow - 1);
  }

  function calc() {
    const amountUsd = Number($('#monto').value || 0);
    const amountBs = Number($('#montoBs')?.value || 0);
    const rate = Number($('#tasa').value || 0);
    const years = Number($('#anios').value || 0);
    const validTerms = rate >= 0 && years > 0;
    const totalRate = rate + Number(settings.seguro_desgravamen || INSURANCE_DEFAULT);
    const n = years * 12;
    const i = (totalRate / 100) / 12;
    lastMonthlyUsd = validTerms && amountUsd > 0 ? Math.round(payment(amountUsd, i, n)) : 0;
    lastMonthlyBs = validTerms && amountBs > 0 ? Math.round(payment(amountBs, i, n)) : 0;
    $('#resUSD').textContent = moneyUSD(lastMonthlyUsd);
    $('#resBOB').textContent = moneyBs(lastMonthlyBs);
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
    return {
      clientId: selectedClientId, vehicleId: selectedVehicle?.id || '', vehicleText: $('#buscarVehiculo').value,
      price: $('#precio').value, priceBs: $('#precioBs').value, initial: $('#inicial').value, initialBs: $('#inicialBs').value,
      amount: $('#monto').value, amountBs: $('#montoBs').value, rate: $('#tasa').value, years: $('#anios').value,
      initialPct, financeMode, financeSourceCurrency, priceBsModeQuote
    };
  }
  function persistQuoteDraft() {
    if (!session || selectedEditingQuoteId) return;
    try { localStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(quoteDraftData())); } catch (_) {}
  }
  function restoreQuoteDraft() {
    if (!session || selectedEditingQuoteId) return;
    let d; try { d = JSON.parse(localStorage.getItem(QUOTE_DRAFT_KEY) || 'null'); } catch (_) { return; }
    if (!d) { updateChipGroup('chips-tasa', Number($('#tasa').value || settings.tasa_interes_default || 16), 'val'); updateChipGroup('chips-anios', Number($('#anios').value || 5), 'val'); updateChipGroup('chips-pct-inicial', 0, 'pct'); return; }
    selectedClientId = clients.some(c=>c.id===d.clientId) ? d.clientId : '';
    selectedVehicle = vehicles.find(v=>String(v.id)===String(d.vehicleId)) || null;
    $('#quoteClientSelect').value = selectedClientId;
    $('#buscarVehiculo').value = selectedVehicle?.nombre || d.vehicleText || '';
    $('#precio').value = d.price || ''; $('#precioBs').value = d.priceBs || ''; $('#inicial').value = d.initial || ''; $('#inicialBs').value = d.initialBs || '';
    $('#monto').value = d.amount || ''; $('#montoBs').value = d.amountBs || ''; $('#tasa').value = d.rate || settings.tasa_interes_default || 16; $('#anios').value = d.years || 5;
    initialPct = d.initialPct ?? null; financeMode = d.financeMode || 'initial'; financeSourceCurrency = d.financeSourceCurrency || 'usd'; priceBsModeQuote = d.priceBsModeQuote || 'tipo_cambio';
    updateSelectedVehicleUI(); updateChipGroup('chips-tasa', Number($('#tasa').value), 'val'); updateChipGroup('chips-anios', Number($('#anios').value), 'val'); updateInitialChipFromManual(); calc();
  }

  function resetQuote() {
    selectedClientId = '';
    selectedEditingQuoteId = '';
    initialPct = 0; financeMode = 'initial'; financeSourceCurrency = 'usd'; priceBsModeQuote = 'tipo_cambio';
    lastMonthlyUsd = 0; lastMonthlyBs = 0;
    clearSelectedVehicle();
    if ($('#quoteClientSelect')) $('#quoteClientSelect').value = '';
    ['precio','precioBs','inicial','inicialBs','monto','montoBs'].forEach(id => { $(`#${id}`).value = ''; });
    $('#tasa').value = Number(settings.tasa_interes_default || 16);
    $('#anios').value = 5;
    $('#resUSD').textContent = '$ 0'; $('#resBOB').textContent = 'Bs 0';
    $('#quoteSaveStatus').textContent = '';
    $('#saveQuoteBtn').textContent = 'Guardar cotización';
    updateChipGroup('chips-pct-inicial', 0, 'pct');
    updateChipGroup('chips-tasa', Number($('#tasa').value), 'val');
    updateChipGroup('chips-anios', 5, 'val');
    try { localStorage.removeItem(QUOTE_DRAFT_KEY); } catch (_) {}
    calc(); showToast('Nueva cotización lista.');
  }

  // --------------------------------------------------------------
  // Guardar / editar cotizaciones
  // --------------------------------------------------------------
  function buildQuoteMessage() {
    const tc = currentTc();
    const price = Number($('#precio').value || 0);
    const priceBs = Number($('#precioBs').value || effectivePriceBs() || 0);
    const initial = Number($('#inicial').value || 0);
    const amount = Number($('#monto').value || 0);
    const initialBs = Number($('#inicialBs').value || 0);
    const amountBs = Number($('#montoBs').value || 0);
    const tasa = $('#tasa').value;
    const years = $('#anios').value;
    let msg = `🚗 *AUTOSALE MOTORS - FINANCIAMIENTO*\n\n`;
    if (selectedVehicle?.nombre || $('#buscarVehiculo').value.trim()) msg += `🚘 *Vehículo: ${selectedVehicle?.nombre || $('#buscarVehiculo').value.trim()}*\n\n`;
    if (selectedClientId) {
      const client = clients.find(c => c.id === selectedClientId);
      if (client?.nombre_completo) msg += `👤 *Cliente: ${client.nombre_completo}*\n\n`;
    }
    msg += `• Tipo de Cambio: Bs ${tc}\n`;
    if (price || priceBs) msg += `• Precio: ${moneyUSD(price)} (${moneyBs(priceBs)})\n`;
    msg += `• Cuota Inicial: ${moneyUSD(initial)} (${moneyBs(initialBs)})\n`;
    msg += `• Monto a Financiar: ${moneyUSD(amount)} (${moneyBs(amountBs)})\n`;
    msg += `• Tasa de Interés: ${tasa}%\n`;
    msg += `• Plazo: ${years} años\n\n`;
    msg += `👉 *Cuota mensual: ${moneyUSD(lastMonthlyUsd)}* (${moneyBs(lastMonthlyBs)}/mes)`;
    return msg;
  }

  async function shareQuote() {
    const msg = buildQuoteMessage();
    if (navigator.share) {
      try { await navigator.share({ text: msg }); return; } catch (_) {}
    }
    try { await navigator.clipboard.writeText(msg); showToast('Cotización copiada.'); }
    catch (_) {
      const textArea = document.createElement('textarea'); textArea.value = msg; textArea.style.position='fixed'; textArea.style.opacity='0';
      document.body.appendChild(textArea); textArea.focus(); textArea.select();
      try { document.execCommand('copy'); showToast('Cotización copiada.'); } catch { showToast('No se pudo copiar la cotización.', 'error'); }
      document.body.removeChild(textArea);
    }
  }

  function quotePayload() {
    const client = clients.find(c => c.id === selectedClientId);
    return {
      cliente_id: selectedClientId || null,
      asesor_id: profile.role === 'admin' ? (client?.asesor_id || session.user.id) : session.user.id,
      vehiculo_id: selectedVehicle?.id || null,
      vehiculo_nombre: selectedVehicle?.nombre || $('#buscarVehiculo').value.trim(),
      precio_usd: Number($('#precio').value || 0),
      precio_bs: Number($('#precioBs').value || effectivePriceBs() || 0),
      cuota_inicial_usd: Number($('#inicial').value || 0),
      cuota_inicial_bs: Number($('#inicialBs').value || 0),
      monto_financiado_usd: Number($('#monto').value || 0),
      monto_financiado_bs: Number($('#montoBs').value || 0),
      tasa_interes: Number($('#tasa').value || 0),
      seguro_desgravamen: Number(settings.seguro_desgravamen || 0),
      plazo_anios: Number($('#anios').value || 0),
      cuota_mensual_usd: lastMonthlyUsd,
      cuota_mensual_bs: lastMonthlyBs,
      notas: ''
    };
  }

  async function saveQuote() {
    if (!db || !session) return;
    const payload = quotePayload();
    if (payload.precio_usd <= 0 && payload.monto_financiado_usd <= 0 && payload.monto_financiado_bs <= 0) return showToast('Ingresa un precio o un monto a financiar.', 'error');
    const result = selectedEditingQuoteId
      ? await db.from('cotizaciones').update(payload).eq('id', selectedEditingQuoteId).select('id,numero').single()
      : await db.from('cotizaciones').insert(payload).select('id,numero').single();
    if (result.error) { console.error(result.error); return showToast('No se pudo guardar la cotización.', 'error'); }
    const wasEditing = Boolean(selectedEditingQuoteId);
    selectedEditingQuoteId = result.data.id;
    $('#quoteSaveStatus').textContent = wasEditing ? `Cotización #${result.data.numero} actualizada` : `Guardada como #${result.data.numero}`;
    showToast(wasEditing ? `Cotización #${result.data.numero} actualizada.` : `Cotización #${result.data.numero} guardada.`);
    $('#saveQuoteBtn').textContent = `Actualizar #${result.data.numero}`;
    try { localStorage.removeItem(QUOTE_DRAFT_KEY); } catch (_) {}
    await loadQuotesSummary();
  }

  async function loadQuoteForEdit(id) {
    let q = quotesSummary.find(item => String(item.id) === String(id));
    if (!q) {
      const res = await db.from('cotizaciones').select('*').eq('id', id).single();
      if (res.error) return showToast(res.error.message, 'error');
      q = res.data;
    }
    selectedEditingQuoteId = q.id;
    selectedClientId = q.cliente_id || '';
    selectedVehicle = vehicles.find(v => String(v.id) === String(q.vehiculo_id)) || null;
    $('#quoteClientSelect').value = selectedClientId;
    $('#buscarVehiculo').value = selectedVehicle?.nombre || q.vehiculo_nombre || '';
    $('#precio').value = Number(q.precio_usd || 0) || '';
    $('#precioBs').value = Number(q.precio_bs || 0) || '';
    $('#inicial').value = Number(q.cuota_inicial_usd || 0) || '';
    $('#inicialBs').value = Number(q.cuota_inicial_bs || 0) || (q.precio_usd ? Math.round(Number(q.cuota_inicial_usd||0) * (Number(q.precio_bs||0)/Number(q.precio_usd||1))) : '') || '';
    $('#monto').value = Number(q.monto_financiado_usd || 0) || '';
    $('#montoBs').value = Number(q.monto_financiado_bs || 0) || (q.precio_usd ? Math.round(Number(q.monto_financiado_usd||0) * (Number(q.precio_bs||0)/Number(q.precio_usd||1))) : '') || '';
    $('#tasa').value = Number(q.tasa_interes || settings.tasa_interes_default || 16);
    $('#anios').value = Number(q.plazo_anios || 5);
    priceBsModeQuote = 'manual'; financeMode = 'initial'; initialPct = null;
    updateSelectedVehicleUI(); updateInitialChipFromManual(); updateChipGroup('chips-tasa', Number($('#tasa').value), 'val'); updateChipGroup('chips-anios', Number($('#anios').value), 'val'); calc();
    $('#saveQuoteBtn').textContent = `Actualizar #${q.numero}`;
    $('#quoteSaveStatus').textContent = `Editando cotización #${q.numero}`;
    closeModal('clientQuotesModal'); navigateToView('cotizadorView');
  }

  async function deleteQuote(id) {
    if (!confirm('¿Eliminar esta cotización? Podrá recuperarse desde la papelera del administrador.')) return;
    const { error } = await db.from('cotizaciones').update({ deleted_at:new Date().toISOString() }).eq('id', id);
    if (error) return showToast(error.message, 'error');
    if (selectedEditingQuoteId === id) resetQuote();
    await loadQuotesSummary();
    if (historyClientId) await openClientQuotes(historyClientId, false);
    if (profile.role === 'admin') await loadTrash();
    showToast('Cotización eliminada.');
  }

  async function exportQuotesCsv() {
    const rows = [['N°','Cliente','Vehículo','Precio USD','Precio Bs','Inicial USD','Inicial Bs','Financiado USD','Financiado Bs','Tasa','Plazo','Cuota USD','Cuota Bs','Fecha']];
    quotesSummary.forEach(q => {
      const c = clients.find(x=>x.id===q.cliente_id);
      rows.push([q.numero,c?.nombre_completo||'',q.vehiculo_nombre||'',q.precio_usd,q.precio_bs,q.cuota_inicial_usd,q.cuota_inicial_bs,q.monto_financiado_usd,q.monto_financiado_bs,q.tasa_interes,q.plazo_anios,q.cuota_mensual_usd,q.cuota_mensual_bs,formatDateTime(q.created_at)]);
    });
    downloadCsv(`autosale-cotizaciones-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }

  // --------------------------------------------------------------
  // Clientes
  // --------------------------------------------------------------
  function renderClientSelect() {
    const select = $('#quoteClientSelect'); if (!select) return;
    select.innerHTML = `<option value="">Sin cliente</option>` + clients.map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)} · ${escapeHtml(c.celular)}</option>`).join('');
    select.value = selectedClientId;
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

  function populateClientAdvisorFilter() {
    const select = $('#clientAdvisorFilter'); if (!select || !profile) return;
    if (profile.role !== 'admin') { select.hidden = true; return; }
    select.hidden = false;
    const current = select.value;
    select.innerHTML = `<option value="">Todos los asesores</option>` + teamMembers().map(a=>`<option value="${a.id}">${escapeHtml(a.full_name || 'Sin nombre')}</option>`).join('');
    select.value = current;
  }

  function clientStatusClass(status) {
    return ({ vendido:'status-badge--done', perdido:'status-badge--danger', esperando_credito:'status-badge--warning', en_seguimiento:'status-badge--active' })[status] || '';
  }

  function clientCard(c) {
    const tradeinBadge = c.permuta ? `<span class="status-badge status-badge--warning">Permuta · ${escapeHtml(c.permuta.estado_revision || 'pendiente')}</span>` : '';
    const last = lastActivityForClient(c.id);
    const next = latestPendingFollowup(c.id);
    const timing = next ? followupTimingLabel(next.programado_para) : null;
    return `<article class="crm-card crm-card--compact" data-client-id="${c.id}">
      <div class="crm-card__main">
        <div class="crm-card__title-row"><h3>${escapeHtml(c.nombre_completo)}</h3><span class="status-badge ${clientStatusClass(c.estado)}">${escapeHtml(quoteStatusLabel(c.estado))}</span>${tradeinBadge}</div>
        <p>${escapeHtml(c.celular)}${c.vehiculo?.nombre ? ` · ${escapeHtml(c.vehiculo.nombre)}` : ''}</p>
        <div class="crm-card__meta"><span>${escapeHtml(purchaseModeLabel(c.modo_compra))}</span><span>${escapeHtml(c.origen || 'Visita por concesionaria')}</span><span>Última actividad: ${last ? formatDateTime(last) : '—'}</span>${next ? `<span class="due-label due-label--${timing.tone}">${escapeHtml(timing.label)} · ${escapeHtml(next.tipo)}</span>` : '<span>Sin próximo seguimiento</span>'}</div>
      </div>
      <div class="crm-card__actions crm-card__actions--quick">
        <button class="modal__primary" type="button" data-client-quote="${c.id}">Cotizar</button>
        <button class="modal__secondary" type="button" data-client-new-followup="${c.id}">Seguimiento</button>
        <button class="modal__secondary" type="button" data-client-edit="${c.id}">Editar</button>
        <button class="modal__secondary" type="button" data-client-quotes="${c.id}">Cotizaciones</button>
      </div>
    </article>`;
  }

  function filteredClients() {
    const q = normalizeText($('#clientSearch')?.value || '');
    const status = $('#clientStatusFilter')?.value || '';
    const mode = $('#clientModeFilter')?.value || '';
    const trade = $('#clientTradeFilter')?.value || '';
    const inactive = Number($('#clientInactiveFilter')?.value || 0);
    const advisor = $('#clientAdvisorFilter')?.value || '';
    return clients.filter(c => {
      const haystack = normalizeText(`${c.nombre_completo} ${c.celular} ${c.vehiculo?.nombre || ''}`);
      if (q && !haystack.includes(q)) return false;
      if (status && c.estado !== status) return false;
      if (mode && c.modo_compra !== mode) return false;
      if (trade === 'si' && !c.permuta) return false;
      if (trade === 'no' && c.permuta) return false;
      if (advisor && c.asesor_id !== advisor) return false;
      if (inactive && daysSince(lastActivityForClient(c.id)) < inactive) return false;
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
    const lost = $('#clientStatus')?.value === 'perdido';
    if ($('#clientLostReasonField')) $('#clientLostReasonField').hidden = !lost;
  }

  function clientDraftData() {
    if ($('#clientId')?.value) return null;
    return {
      name:$('#clientName').value, phone:$('#clientPhone').value, origin:$('#clientOrigin').value,
      vehicle:$('#clientVehicle').value, mode:$('#clientPurchaseMode').value, status:$('#clientStatus').value,
      lostReason:$('#clientLostReason').value, advisor:$('#clientAdvisor').value, notes:$('#clientNotes').value,
      hasTrade:$('#clientHasTradein').checked, trade:{brand:$('#tradeBrand').value,model:$('#tradeModel').value,year:$('#tradeYear').value,plate:$('#tradePlate').value,engine:$('#tradeEngine').value,fuel:$('#tradeFuel').value,price:$('#tradeEstimated').value,review:$('#tradeReview').value}
    };
  }
  function persistClientDraft() {
    const d = clientDraftData(); if (!d) return;
    try { localStorage.setItem(CLIENT_DRAFT_KEY, JSON.stringify(d)); } catch (_) {}
  }
  function restoreClientDraft() {
    let d; try { d=JSON.parse(localStorage.getItem(CLIENT_DRAFT_KEY)||'null'); } catch(_) { return; }
    if (!d) return;
    $('#clientName').value=d.name||''; $('#clientPhone').value=d.phone||''; $('#clientOrigin').value=d.origin||'Visita por concesionaria'; $('#clientVehicle').value=d.vehicle||''; $('#clientPurchaseMode').value=d.mode||''; $('#clientStatus').value=d.status||'en_seguimiento'; $('#clientLostReason').value=d.lostReason||''; $('#clientAdvisor').value=d.advisor||session.user.id; $('#clientNotes').value=d.notes||'';
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
    const existing = clients.find(c => String(c.id) === String(clientId));
    $('#clientId').value = existing?.id || '';
    $('#clientModalTitle').textContent = existing ? 'Editar cliente' : 'Nuevo cliente';
    $('#clientName').value = existing?.nombre_completo || '';
    $('#clientPhone').value = existing?.celular || '';
    $('#clientOrigin').value = existing?.origen || 'Visita por concesionaria';
    $('#clientVehicle').value = existing?.vehiculo_interes_id || '';
    const allowedModes = ['contado','garante_personal','hipotecario_vehicular','hipotecado_inmueble'];
    $('#clientPurchaseMode').value = allowedModes.includes(existing?.modo_compra) ? existing.modo_compra : '';
    const allowedStatuses = ['en_seguimiento','vendido','perdido','esperando_credito'];
    $('#clientStatus').value = allowedStatuses.includes(existing?.estado) ? existing.estado : 'en_seguimiento';
    $('#clientLostReason').value = existing?.motivo_perdida || '';
    $('#clientNotes').value = existing?.notas || '';
    const trade = existing?.permuta || null;
    $('#clientHasTradein').checked = Boolean(trade);
    $('#tradeinFields').hidden = !trade;
    $('#tradeBrand').value = trade?.marca || ''; $('#tradeModel').value = trade?.modelo || ''; $('#tradeYear').value = trade?.anio || ''; $('#tradePlate').value = trade?.placa || ''; $('#tradeEngine').value = trade?.motor || ''; $('#tradeFuel').value = trade?.combustible || ''; $('#tradeEstimated').value = trade?.valor_estimado ?? ''; $('#tradeReview').value = ['pendiente','revisado','rechazado'].includes(trade?.estado_revision) ? trade.estado_revision : 'pendiente';
    populateAdvisorSelect(); $('#clientAdvisor').value = existing?.asesor_id || session.user.id;
    $('#archiveClientBtn').hidden = !existing;
    syncClientConditionalFields();
    if (!existing) restoreClientDraft();
    await renderAssignmentHistory(existing?.id || '');
    openModal('clientModal');
  }

  async function saveClient(event) {
    event.preventDefault();
    const id = $('#clientId').value;
    let advisorId = $('#clientAdvisor').value || session.user.id;
    if (profile.role !== 'admin') advisorId = session.user.id;
    const phone = $('#clientPhone').value.trim();
    const duplicate = clients.find(c => c.id !== id && phoneKey(c.celular) && phoneKey(c.celular) === phoneKey(phone));
    if (duplicate && !confirm(`Ya existe un cliente con este celular: ${duplicate.nombre_completo}. ¿Deseas guardar de todas formas?`)) return;
    const lost = $('#clientStatus').value === 'perdido';
    const payload = {
      nombre_completo: $('#clientName').value.trim(), celular: phone, whatsapp:null,
      origen: $('#clientOrigin').value.trim() || 'Visita por concesionaria',
      vehiculo_interes_id: $('#clientVehicle').value || null, modo_compra: $('#clientPurchaseMode').value || null,
      presupuesto_usd:null, estado:$('#clientStatus').value, motivo_perdida:lost ? ($('#clientLostReason').value.trim() || null) : null,
      notas:$('#clientNotes').value.trim(), asesor_id:advisorId, creado_por:id ? undefined : session.user.id
    };
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
    const result = id ? await db.from('clientes').update(payload).eq('id',id).select('*').single() : await db.from('clientes').insert(payload).select('*').single();
    if (result.error) return showToast(result.error.message,'error');
    const clientId=result.data.id;
    if (!id) {
      const now=new Date(); const localToday=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      const visitResult=await db.from('cliente_visitas').insert({cliente_id:clientId,fecha:localToday,notas:'',creado_por:session.user.id});
      if (visitResult.error) console.warn('[Autosale] visita inicial:', visitResult.error.message);
    }
    if ($('#clientHasTradein').checked) {
      const tradePayload={cliente_id:clientId,marca:$('#tradeBrand').value.trim(),modelo:$('#tradeModel').value.trim(),anio:$('#tradeYear').value?Number($('#tradeYear').value):null,placa:$('#tradePlate').value.trim()||null,motor:$('#tradeEngine').value.trim()||null,combustible:$('#tradeFuel').value.trim()||null,valor_estimado:$('#tradeEstimated').value?Number($('#tradeEstimated').value):null,estado_revision:$('#tradeReview').value};
      const tradeResult=await db.from('cliente_permutas').upsert(tradePayload,{onConflict:'cliente_id'}); if(tradeResult.error) console.warn('[Autosale] permuta:',tradeResult.error.message);
    } else if (id) {
      const tradeResult=await db.from('cliente_permutas').delete().eq('cliente_id',clientId); if(tradeResult.error) console.warn('[Autosale] eliminar permuta:',tradeResult.error.message);
    }
    if (payload.estado === 'vendido') await db.from('seguimientos').update({estado:'completado',completado_at:new Date().toISOString()}).eq('cliente_id',clientId).eq('estado','pendiente').is('deleted_at',null);
    try { localStorage.removeItem(CLIENT_DRAFT_KEY); } catch(_) {}
    closeModal('clientModal'); await Promise.all([loadClients(),loadFollowups(),loadQuotesSummary(),profile.role==='admin'?loadAudit():Promise.resolve()]);
    if (!id && clientReturnToQuote) { selectedClientId = clientId; renderClientSelect(); $('#quoteClientSelect').value = clientId; persistQuoteDraft(); navigateToView('cotizadorView'); clientReturnToQuote = false; }
    showToast(id?'Cliente actualizado.':'Cliente creado.');
  }

  async function archiveClient() {
    const id=$('#clientId').value; if(!id) return;
    if(!confirm('¿Archivar este cliente? Se ocultará de la cartera activa y el administrador podrá recuperarlo.')) return;
    const {error}=await db.from('clientes').update({archived_at:new Date().toISOString()}).eq('id',id); if(error) return showToast(error.message,'error');
    closeModal('clientModal'); await loadClients(); if(profile.role==='admin') await loadTrash(); showToast('Cliente archivado.');
  }

  function startQuoteForClient(clientId) {
    resetQuote(); selectedClientId=clientId; $('#quoteClientSelect').value=clientId; persistQuoteDraft(); navigateToView('cotizadorView');
  }

  async function openClientQuotes(clientId, reopen = true) {
    const client=clients.find(c=>String(c.id)===String(clientId)); historyClientId=clientId;
    $('#clientQuotesTitle').textContent=`Cotizaciones · ${client?.nombre_completo||'Cliente'}`;
    const list=$('#clientQuotesList'); list.innerHTML='<div class="empty-state">Cargando cotizaciones…</div>'; if(reopen) openModal('clientQuotesModal');
    const {data,error}=await db.from('cotizaciones').select('id,numero,cliente_id,vehiculo_id,vehiculo_nombre,precio_usd,precio_bs,cuota_inicial_usd,cuota_inicial_bs,monto_financiado_usd,monto_financiado_bs,tasa_interes,plazo_anios,cuota_mensual_usd,cuota_mensual_bs,created_at,updated_at').eq('cliente_id',clientId).is('deleted_at',null).order('created_at',{ascending:false});
    if(error){list.innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;return;}
    list.innerHTML=data?.length?data.map(q=>`<article class="history-card"><div class="history-card__head"><div><span class="cotizador__tag">#${q.numero}</span><h3>${escapeHtml(q.vehiculo_nombre||'Sin vehículo')}</h3></div><time>${formatDateTime(q.updated_at||q.created_at)}</time></div><div class="history-card__grid"><div><span>Precio</span><strong>${moneyUSD(q.precio_usd)} · ${moneyBs(q.precio_bs)}</strong></div><div><span>Inicial</span><strong>${moneyUSD(q.cuota_inicial_usd)} · ${moneyBs(q.cuota_inicial_bs)}</strong></div><div><span>Financiado</span><strong>${moneyUSD(q.monto_financiado_usd)} · ${moneyBs(q.monto_financiado_bs)}</strong></div><div><span>Plazo</span><strong>${Number(q.plazo_anios||0)} años · ${Number(q.tasa_interes||0)}%</strong></div><div class="history-card__highlight"><span>Cuota mensual</span><strong>${moneyUSD(q.cuota_mensual_usd)} · ${moneyBs(q.cuota_mensual_bs)}</strong></div></div><div class="history-card__actions"><button class="modal__secondary" data-quote-edit="${q.id}" type="button">Editar</button><button class="danger-button" data-quote-delete="${q.id}" type="button">Eliminar</button></div></article>`).join(''):'<div class="empty-state">Este cliente todavía no tiene cotizaciones guardadas.</div>';
  }

  async function exportClientsCsv() {
    const rows=[['Nombre','Celular','Origen','Vehículo','Modo de compra','Estado','Permuta','Última actividad']];
    filteredClients().forEach(c=>rows.push([c.nombre_completo,c.celular,c.origen,c.vehiculo?.nombre||'',purchaseModeLabel(c.modo_compra),quoteStatusLabel(c.estado),c.permuta?'Sí':'No',formatDateTime(lastActivityForClient(c.id))]));
    downloadCsv(`autosale-clientes-${new Date().toISOString().slice(0,10)}.csv`,rows);
  }

  // --------------------------------------------------------------
  // Seguimientos
  // --------------------------------------------------------------
  function populateFollowupClients() {
    const html = clients.map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('');
    $('#followupClient').innerHTML = html;
  }

  function followupHistoryCard(f) {
    const date = formatDateTime(f.programado_para);
    const created = f.created_at ? formatDateTime(f.created_at) : '';
    const completed = f.completado_at ? formatDateTime(f.completado_at) : '';
    return `<article class="history-card history-card--followup">
      <div class="history-card__head"><div><span class="status-badge">${escapeHtml(f.tipo || 'Seguimiento')}</span><h3>${escapeHtml(f.cliente?.nombre_completo || 'Seguimiento')}</h3></div><span class="status-badge ${f.estado === 'completado' ? 'status-badge--done' : ''}">${f.estado === 'completado' ? 'Completado' : 'Vigente'}</span></div>
      <div class="history-card__followup-date">${escapeHtml(date)}</div>${f.notas ? `<p>${escapeHtml(f.notas)}</p>` : ''}
      <small>Registrado: ${escapeHtml(created)}${completed ? ` · Completado: ${escapeHtml(completed)}` : ''}${f.asesor?.full_name ? ` · ${escapeHtml(f.asesor.full_name)}` : ''}</small>
      <div class="history-card__actions"><button type="button" class="modal__secondary" data-followup-edit="${f.id}">Editar</button><button type="button" class="danger-button" data-followup-delete="${f.id}" data-followup-client="${f.cliente_id || historyClientId}">Eliminar</button></div>
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
    return `<article class="crm-card crm-card--compact followup-card"><div class="crm-card__main"><div class="crm-card__title-row"><h3>${escapeHtml(f.cliente?.nombre_completo||'Cliente')}</h3><span class="status-badge">${escapeHtml(f.tipo)}</span><span class="due-label due-label--${timing.tone}">${escapeHtml(timing.label)}</span></div><p>${escapeHtml(formatDateTime(f.programado_para))}</p><small>${escapeHtml(f.notas||'Sin notas')}</small></div><div class="crm-card__actions"><button class="modal__secondary" type="button" data-followup-edit="${f.id}">Editar</button><button class="modal__secondary" type="button" data-followup-history-client="${f.cliente_id}">Historial</button><button class="modal__secondary" type="button" data-followup-complete="${f.id}">Completar</button><button class="danger-button" type="button" data-followup-delete="${f.id}" data-followup-client="${f.cliente_id}">Eliminar</button></div></article>`;
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
    const local=followups.find(f=>String(f.id)===String(id)); if(local) return local;
    const {data,error}=await db.from('seguimientos').select('*,cliente:clientes(id,nombre_completo,celular,estado),asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)').eq('id',id).single();
    if(error){showToast(error.message,'error');return null;} return data;
  }

  async function openFollowup(clientId = '', followupId = '') {
    const item=followupId?await getFollowupById(followupId):null;
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
    const id=$('#followupId').value; const clientId=$('#followupClient').value; if(!clientId)return showToast('Selecciona un cliente.','error');
    const client=clients.find(c=>c.id===clientId); const dateTime=combineLocalDateTime($('#followupDate').value,$('#followupTime').value);
    if(!dateTime)return showToast('Selecciona una fecha válida.','error');
    const payload={cliente_id:clientId,asesor_id:profile.role==='admin'?(client?.asesor_id||session.user.id):session.user.id,tipo:$('#followupType').value,programado_para:dateTime,estado:'pendiente',notas:$('#followupNotes').value.trim(),completado_at:null,creado_por:session.user.id};
    let result;
    if(id) result=await db.from('seguimientos').update(payload).eq('id',id).select('id').single(); else result=await db.from('seguimientos').insert(payload).select('id').single();
    if(result.error)return showToast(result.error.message,'error');
    await db.from('seguimientos').update({estado:'completado',completado_at:new Date().toISOString()}).eq('cliente_id',clientId).eq('estado','pendiente').neq('id',result.data.id).is('deleted_at',null);
    closeModal('followupModal'); await loadFollowups(); if(historyClientId===clientId && !$('#clientFollowupsModal').hidden) await openClientFollowupsHistory(clientId,false); showToast(id?'Seguimiento actualizado.':'Seguimiento creado.');
  }

  async function toggleFollowup(id) {
    const item=await getFollowupById(id); if(!item)return;
    const completed=item.estado!=='completado';
    const {error}=await db.from('seguimientos').update({estado:completed?'completado':'pendiente',completado_at:completed?new Date().toISOString():null}).eq('id',id);
    if(error)return showToast(error.message,'error'); await loadFollowups(); showToast(completed?'Seguimiento completado.':'Seguimiento reabierto.');
  }

  async function deleteFollowup(id, clientId) {
    if(!confirm('¿Eliminar este seguimiento? Podrá recuperarse desde la papelera del administrador.'))return;
    const item=await getFollowupById(id);
    const {error}=await db.from('seguimientos').update({deleted_at:new Date().toISOString()}).eq('id',id); if(error)return showToast(error.message,'error');
    const client=clients.find(c=>c.id===clientId);
    if(item?.estado==='pendiente' && client?.estado!=='vendido'){
      const {data:previous}=await db.from('seguimientos').select('id').eq('cliente_id',clientId).is('deleted_at',null).neq('id',id).order('programado_para',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(previous?.id) await db.from('seguimientos').update({estado:'pendiente',completado_at:null}).eq('id',previous.id);
    }
    await loadFollowups(); if(historyClientId===clientId && !$('#clientFollowupsModal').hidden) await openClientFollowupsHistory(clientId,false); if(profile.role==='admin')await loadTrash(); showToast('Seguimiento eliminado.');
  }

  async function openClientFollowupsHistory(clientId,reopen=true) {
    const client=clients.find(c=>String(c.id)===String(clientId)); historyClientId=clientId; $('#clientFollowupsTitle').textContent=`Seguimientos · ${client?.nombre_completo||'Cliente'}`;
    const list=$('#clientFollowupsHistoryList'); list.innerHTML='<div class="empty-state">Cargando seguimientos…</div>'; if(reopen)openModal('clientFollowupsModal');
    const {data,error}=await db.from('seguimientos').select('id,cliente_id,tipo,programado_para,estado,notas,completado_at,created_at,updated_at,asesor:profiles!seguimientos_asesor_id_fkey(id,full_name),cliente:clientes(id,nombre_completo)').eq('cliente_id',clientId).is('deleted_at',null).order('created_at',{ascending:false});
    if(error){list.innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;return;}
    list.innerHTML=data?.length?data.map(f=>followupHistoryCard(f)).join(''):'<div class="empty-state">Este cliente todavía no tiene seguimientos registrados.</div>';
  }

  // --------------------------------------------------------------
  // Administración: vehículos, settings, asesores, auditoría
  // --------------------------------------------------------------
  function renderVehicleAdmin() {
    const list = $('#adminVehicleList'); if (!list) return;
    $('#adminVehicleCount').textContent = vehicles.length;
    list.innerHTML = vehicles.length ? vehicles.map(v => `<div class="vehicle-item"><div class="vehicle-item__info"><strong>${escapeHtml(v.nombre)}</strong><span>${moneyUSD(v.precio)} · ${moneyBs(v.precio_bs_modo === 'manual' ? v.precio_bs_manual : v.precio * settings.tipo_cambio)}</span><small>${escapeHtml(v.estado_interno || 'disponible')} · ${v.public_published ? 'Web publicada' : 'No publicada'}</small></div><div class="vehicle-item__actions"><button type="button" class="vehicle-item__btn" data-edit-vehicle="${v.id}">✎</button><button type="button" class="vehicle-item__btn vehicle-item__btn--danger" data-delete-vehicle="${v.id}">×</button></div></div>`).join('') : '<div class="vehicle-list__empty">Sin vehículos.</div>';
  }

  function resetVehicleForm() {
    $('#vehicleId').value=''; $('#vehicleName').value=''; $('#vehiclePriceUsd').value=''; $('#vehiclePriceBs').value=''; $('#vehiclePriceBsMode').value='tipo_cambio'; $('#vehicleInternalStatus').value='disponible'; $('#saveVehicleBtn').textContent='Agregar vehículo';
  }
  function openVehicleAdmin(id='') {
    resetVehicleForm();
    const v = vehicles.find(x => String(x.id) === String(id));
    if (v) {
      $('#vehicleId').value=v.id; $('#vehicleName').value=v.nombre; $('#vehiclePriceUsd').value=v.precio; $('#vehiclePriceBs').value=v.precio_bs_manual ?? ''; $('#vehiclePriceBsMode').value=v.precio_bs_modo || 'tipo_cambio'; $('#vehicleInternalStatus').value=v.estado_interno || 'disponible'; $('#saveVehicleBtn').textContent='Guardar cambios';
    }
    renderVehicleAdmin(); openModal('vehicleAdminModal');
  }

  async function saveVehicle(event) {
    event.preventDefault();
    const id = $('#vehicleId').value;
    const payload = { nombre: $('#vehicleName').value.trim(), precio: Number($('#vehiclePriceUsd').value), precio_bs_manual: $('#vehiclePriceBs').value ? Number($('#vehiclePriceBs').value) : null, precio_bs_modo: $('#vehiclePriceBsMode').value, estado_interno: $('#vehicleInternalStatus').value };
    if (!payload.nombre || !Number.isFinite(payload.precio) || payload.precio < 0) return showToast('Completa nombre y precio correctamente.', 'error');
    const result = id ? await db.from('vehiculos').update(payload).eq('id', id).select('*').single() : await db.from('vehiculos').insert(payload).select('*').single();
    if (result.error) return showToast(result.error.message, 'error');
    await loadVehicles(); resetVehicleForm(); showToast(id ? 'Vehículo actualizado.' : 'Vehículo agregado.');
  }
  async function deleteVehicle(id) {
    if (!confirm('¿Eliminar este vehículo del sistema?')) return;
    const { error } = await db.from('vehiculos').delete().eq('id', id); if (error) return showToast(error.message, 'error');
    await loadVehicles(); showToast('Vehículo eliminado.');
  }

  async function saveSettings(event) {
    event.preventDefault();
    const payload = { id: 1, tipo_cambio: Number($('#settingTc').value), tasa_interes_default: Number($('#settingRate').value), seguro_desgravamen: Number($('#settingInsurance').value), updated_by: session.user.id };
    const { error } = await db.from('app_settings').upsert(payload);
    if (error) return showToast(error.message, 'error');
    settings = { ...settings, ...payload }; $('#tc').value=settings.tipo_cambio; $('#tasa').value=settings.tasa_interes_default; updateChipGroup('chips-tasa', Number(settings.tasa_interes_default||16), 'val'); calc(); persistQuoteDraft(); showToast('Configuración guardada.');
  }
  function renderAdvisors() {
    if (!$('#advisorsList')) return;
    $('#advisorsList').innerHTML = advisors.length ? advisors.map(a => {
      const advisorClients = clients.filter(c => c.asesor_id === a.id);
      const advisorFollowups = followups.filter(f => f.asesor_id === a.id && f.estado === 'pendiente');
      return `<div class="simple-list__row"><div><strong>${escapeHtml(a.full_name || 'Sin nombre')}</strong><span>${a.active ? 'Activo' : 'Inactivo'} · ${advisorClients.length} clientes · ${advisorFollowups.length} seguimientos vigentes</span></div><span>Asesor</span></div>`;
    }).join('') : '<div class="empty-state">No hay asesores registrados.</div>';
  }

  function advisorStats(member) {
    const memberClients=clients.filter(c=>c.asesor_id===member.id);
    const pending=followups.filter(f=>f.asesor_id===member.id&&f.estado==='pendiente');
    const overdue=pending.filter(f=>f.programado_para&&new Date(f.programado_para)<new Date()).length;
    const quotes=quotesSummary.filter(q=>q.asesor_id===member.id);
    const weekAgo=Date.now()-7*86400000;
    const noMovement=memberClients.filter(c=>daysSince(lastActivityForClient(c.id))>=15).length;
    return { memberClients,pending,overdue,quotes,weekQuotes:quotes.filter(q=>new Date(q.created_at).getTime()>=weekAgo).length,noMovement,count:s=>memberClients.filter(c=>c.estado===s).length };
  }

  function renderAdvisorActivity() {
    const container=$('#advisorActivityList'); if(!container||profile?.role!=='admin')return;
    const currentAdmin={id:session.user.id,full_name:profile.full_name||'Administrador',role:'admin',active:true};
    const team=[currentAdmin,...advisors.filter(a=>a.id!==currentAdmin.id)];
    container.innerHTML=team.map(member=>{
      const st=advisorStats(member);
      const dates=[...st.memberClients.map(c=>lastActivityForClient(c.id)),...st.pending.map(f=>f.updated_at||f.created_at),...st.quotes.map(q=>q.updated_at||q.created_at)].filter(Boolean).map(d=>new Date(d).getTime()).filter(Number.isFinite);
      const lastActivity=dates.length?formatDateTime(new Date(Math.max(...dates)).toISOString()):'Sin actividad';
      return `<article class="advisor-monitor"><header class="advisor-monitor__head"><div><strong>${escapeHtml(member.full_name||'Sin nombre')}</strong><span>${member.role==='admin'?'Administrador':'Asesor'} · ${member.active===false?'Inactivo':'Activo'}</span></div><small>Última actividad: ${escapeHtml(lastActivity)}</small></header><div class="advisor-monitor__metrics">
        <div><strong>${st.memberClients.length}</strong><span>Clientes</span></div><div><strong>${st.count('en_seguimiento')}</strong><span>En seguimiento</span></div><div><strong>${st.count('esperando_credito')}</strong><span>Esperando crédito</span></div><div><strong>${st.count('vendido')}</strong><span>Vendidos</span></div><div><strong>${st.count('perdido')}</strong><span>Perdidos</span></div><div><strong>${st.pending.length}</strong><span>Seguimientos</span></div><div><strong>${st.overdue}</strong><span>Vencidos</span></div><div><strong>${st.weekQuotes}</strong><span>Cotizaciones 7 días</span></div><div><strong>${st.noMovement}</strong><span>Sin movimiento 15+ días</span></div>
      </div></article>`;
    }).join('')||'<div class="empty-state">No hay usuarios comerciales.</div>';
  }

  function populateReassignSelects() {
    if(profile?.role!=='admin')return;
    const all=teamMembers();
    ['reassignFrom','reassignTo'].forEach(id=>{const el=$(`#${id}`);if(!el)return;const old=el.value;el.innerHTML=all.map(a=>`<option value="${a.id}">${escapeHtml(a.full_name||'Sin nombre')}</option>`).join('');if(old)el.value=old;});
    if($('#reassignTo') && $('#reassignTo').value===$('#reassignFrom')?.value && all.length>1) $('#reassignTo').value=all[1].id;
  }

  async function bulkReassignClients() {
    const from=$('#reassignFrom').value,to=$('#reassignTo').value;if(!from||!to||from===to)return showToast('Selecciona dos usuarios distintos.','error');
    const count=clients.filter(c=>c.asesor_id===from).length;if(!count)return showToast('Ese usuario no tiene clientes activos.','error');
    if(!confirm(`¿Reasignar ${count} cliente(s) activos al usuario seleccionado?`))return;
    const {error}=await db.from('clientes').update({asesor_id:to}).eq('asesor_id',from).is('archived_at',null);if(error)return showToast(error.message,'error');
    await Promise.all([loadClients(),loadAudit()]);showToast(`${count} cliente(s) reasignados.`);
  }

  function renderAudit() {
    const box=$('#auditList'); if(!box)return;
    const verb={insert:'creó',update:'actualizó',delete:'eliminó'};
    const table={clientes:'cliente',cotizaciones:'cotización',seguimientos:'seguimiento',vehiculos:'vehículo'};
    box.innerHTML=auditRows.length?auditRows.map(r=>`<div class="audit-row"><div><strong>${escapeHtml(r.actor?.full_name||'Sistema')} ${escapeHtml(verb[r.accion]||r.accion)} ${escapeHtml(table[r.tabla]||r.tabla)}</strong><span>${formatDateTime(r.created_at)}</span></div></div>`).join(''):'<div class="empty-state">Sin actividad reciente.</div>';
  }

  function renderTrash() {
    const box=$('#trashList'); if(!box)return;
    const items=[...trashItems.clients.map(x=>({kind:'client',id:x.id,title:x.nombre_completo,meta:`Cliente · ${formatDateTime(x.archived_at)}`})),...trashItems.quotes.map(x=>({kind:'quote',id:x.id,title:`Cotización #${x.numero}`,meta:`${x.vehiculo_nombre||'Sin vehículo'} · ${formatDateTime(x.deleted_at)}`})),...trashItems.followups.map(x=>({kind:'followup',id:x.id,title:x.cliente?.nombre_completo||'Seguimiento',meta:`${x.tipo||''} · ${formatDateTime(x.deleted_at)}`}))];
    box.innerHTML=items.length?items.map(x=>`<div class="trash-row"><div><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.meta)}</span></div><button type="button" class="modal__secondary" data-trash-restore="${x.kind}" data-trash-id="${x.id}">Restaurar</button></div>`).join(''):'<div class="empty-state">Sin elementos eliminados.</div>';
  }

  async function restoreTrash(kind,id) {
    let res;
    if(kind==='client')res=await db.from('clientes').update({archived_at:null}).eq('id',id);
    else if(kind==='quote')res=await db.from('cotizaciones').update({deleted_at:null}).eq('id',id);
    else res=await db.from('seguimientos').update({deleted_at:null}).eq('id',id);
    if(res.error)return showToast(res.error.message,'error');
    await Promise.all([loadClients(),loadFollowups(),loadQuotesSummary(),loadTrash()]);showToast('Registro restaurado.');
  }

  function renderDashboard() {
    if (profile.role !== 'admin') return;
    $('#settingTc').value=settings.tipo_cambio; $('#settingRate').value=settings.tasa_interes_default; $('#settingInsurance').value=settings.seguro_desgravamen;
    $('#adminVehicleSummary').innerHTML = `<div class="metric"><strong>${vehicles.length}</strong><span>Vehículos</span></div>`;
    renderAdvisors(); renderAdvisorActivity(); populateReassignSelects(); renderAudit(); renderTrash();
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
    list.innerHTML = rows.length ? rows.map(v => `<article class="catalog-admin-card"><div class="catalog-admin-card__image">${v.public_image_url ? `<img src="${escapeHtml(v.public_image_url)}" alt="${escapeHtml(publicName(v) || v.nombre)}">` : '<span>Sin imagen</span>'}</div><div class="catalog-admin-card__body"><div class="catalog-admin-card__status"><span class="status-badge">${v.public_published ? 'Publicado' : 'Borrador'}</span>${v.public_featured ? '<span class="status-badge status-badge--warning">Destacado</span>' : ''}${v.public_offer ? '<span class="status-badge status-badge--offer">Oferta</span>' : ''}</div><h3>${escapeHtml(publicName(v) || v.nombre)}</h3><p>${escapeHtml(v.public_engine || 'Motor por definir')}</p><button class="modal__secondary" type="button" data-edit-catalog="${v.id}">Editar ficha</button></div></article>`).join('') : '<div class="empty-state">No hay vehículos.</div>';
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
    if(kind==='vehicle'){navigateToView('cotizadorView');selectVehicle(id);}
    if(kind==='quote'){await loadQuoteForEdit(id);}
  }

  // --------------------------------------------------------------
  // Eventos
  // --------------------------------------------------------------
  function initEvents() {
    $('#loginForm').addEventListener('submit', login);
    $('#logoutBtn').addEventListener('click', logout);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $$('.app-tab').forEach(t => t.addEventListener('click', async () => {
      if (t.dataset.view === 'adminView' && profile?.role === 'admin') await Promise.all([loadClients(),loadFollowups(),loadAdvisors(),loadQuotesSummary(),loadAudit(),loadTrash()]);
      setTimeout(renderDashboard,0);
    }));

    $('#globalSearch').addEventListener('input', renderGlobalSearch);
    $('#globalSearch').addEventListener('focus', renderGlobalSearch);
    $('#globalSearchClear').addEventListener('click',()=>{$('#globalSearch').value='';$('#globalSearchResults').hidden=true;});
    $('#globalSearchResults').addEventListener('click',e=>{const btn=e.target.closest('[data-global-kind]');if(btn)handleGlobalResult(btn.dataset.globalKind,btn.dataset.globalId);});
    document.addEventListener('click',e=>{if(!e.target.closest('#globalSearchWrap'))$('#globalSearchResults').hidden=true;});

    $('#buscarVehiculo').addEventListener('input', renderVehicleSearch);
    $('#buscarVehiculo').addEventListener('focus', renderVehicleSearch);
    $('#buscarVehiculo').addEventListener('keydown', e => { if (e.key==='Escape') $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible'); });
    $('#resultadosVehiculos').addEventListener('click', e => { const btn=e.target.closest('[data-id]'); if(btn) selectVehicle(btn.dataset.id); });
    $('#limpiarVehiculo').addEventListener('click', clearSelectedVehicle); $('#clearSelectedVehicle').addEventListener('click', clearSelectedVehicle);
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
    $('#chips-pct-inicial').addEventListener('click', e => { const chip=e.target.closest('[data-pct]'); if(chip) selectInitialPct(Number(chip.dataset.pct)); });
    $('#chips-tasa').addEventListener('click', e => { const chip=e.target.closest('[data-val]'); if(chip) selectChip('tasa', Number(chip.dataset.val)); });
    $('#chips-anios').addEventListener('click', e => { const chip=e.target.closest('[data-val]'); if(chip) selectChip('anios', Number(chip.dataset.val)); });
    $('#newQuoteBtn').addEventListener('click', resetQuote); $('#shareQuoteBtn').addEventListener('click', shareQuote); $('#saveQuoteBtn').addEventListener('click', saveQuote);
    $('#quoteClientSelect').addEventListener('change', e => { selectedClientId=e.target.value;persistQuoteDraft(); });
    $('#quickClientBtn').addEventListener('click',()=>{clientReturnToQuote=true;openClient();});

    $('#newClientBtn').addEventListener('click',()=>{clientReturnToQuote=false;openClient();});
    ['clientSearch','clientStatusFilter','clientModeFilter','clientTradeFilter','clientInactiveFilter','clientAdvisorFilter'].forEach(id=>{const el=$(`#${id}`);if(el)el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>{clientPage=1;renderClients();});});
    $('#clientsPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-client-page]');if(btn){clientPage=Number(btn.dataset.clientPage)||1;renderClients();}});
    $('#clientsList').addEventListener('click', e => {
      const edit=e.target.closest('[data-client-edit]'),quotes=e.target.closest('[data-client-quotes]'),follow=e.target.closest('[data-client-new-followup]'),quote=e.target.closest('[data-client-quote]');
      if(edit)openClient(edit.dataset.clientEdit); if(quotes)openClientQuotes(quotes.dataset.clientQuotes); if(follow)openFollowup(follow.dataset.clientNewFollowup); if(quote)startQuoteForClient(quote.dataset.clientQuote);
    });
    $('#exportClientsBtn').addEventListener('click',exportClientsCsv); $('#exportQuotesBtn').addEventListener('click',exportQuotesCsv);
    $('#clientForm').addEventListener('input',persistClientDraft); $('#clientForm').addEventListener('change',persistClientDraft);
    $('#clientStatus').addEventListener('change',syncClientConditionalFields);
    $('#clientHasTradein').addEventListener('change',e=>{const on=e.target.checked;$('#tradeinFields').hidden=!on;if(!on)clearTradeinFields();persistClientDraft();});
    $('#clientForm').addEventListener('submit',saveClient); $('#archiveClientBtn').addEventListener('click',archiveClient);

    $('#followupSearch').addEventListener('input',()=>{followupPage=1;renderFollowups();}); $('#followupFilter').addEventListener('change',()=>{followupPage=1;renderFollowups();});
    $('#followupsPagination').addEventListener('click',e=>{const btn=e.target.closest('[data-followup-page]');if(btn){followupPage=Number(btn.dataset.followupPage)||1;renderFollowups();}});
    $('#newFollowupBtn').addEventListener('click',()=>openFollowup());
    $('#followupsList').addEventListener('click', async e => {
      const complete=e.target.closest('[data-followup-complete]'),history=e.target.closest('[data-followup-history-client]'),edit=e.target.closest('[data-followup-edit]'),del=e.target.closest('[data-followup-delete]');
      if(complete)await toggleFollowup(complete.dataset.followupComplete); if(history)await openClientFollowupsHistory(history.dataset.followupHistoryClient); if(edit)await openFollowup('',edit.dataset.followupEdit); if(del)await deleteFollowup(del.dataset.followupDelete,del.dataset.followupClient);
    });
    $('#followupForm').addEventListener('submit',saveFollowup);
    $('#clientHistoryNewFollowupBtn').addEventListener('click',()=>{const id=historyClientId;closeModal('clientFollowupsModal');openFollowup(id);});
    $('#clientHistoryNewQuoteBtn').addEventListener('click',()=>{const id=historyClientId;closeModal('clientQuotesModal');startQuoteForClient(id);});
    $('#clientFollowupsHistoryList').addEventListener('click',async e=>{const edit=e.target.closest('[data-followup-edit]'),del=e.target.closest('[data-followup-delete]');if(edit){closeModal('clientFollowupsModal');await openFollowup(historyClientId,edit.dataset.followupEdit);}if(del)await deleteFollowup(del.dataset.followupDelete,del.dataset.followupClient||historyClientId);});
    $('#clientQuotesList').addEventListener('click',async e=>{const edit=e.target.closest('[data-quote-edit]'),del=e.target.closest('[data-quote-delete]');if(edit)await loadQuoteForEdit(edit.dataset.quoteEdit);if(del)await deleteQuote(del.dataset.quoteDelete);});

    $('#settingsForm').addEventListener('submit',saveSettings); $('#vehicleForm').addEventListener('submit',saveVehicle); $('#catalogForm').addEventListener('submit',saveCatalog);
    $('#openVehicleAdminBtn').addEventListener('click',()=>openVehicleAdmin()); $('#cancelVehicleBtn').addEventListener('click',resetVehicleForm);
    $('#adminVehicleList').addEventListener('click',e=>{const edit=e.target.closest('[data-edit-vehicle]'),del=e.target.closest('[data-delete-vehicle]');if(edit)openVehicleAdmin(edit.dataset.editVehicle);if(del)deleteVehicle(del.dataset.deleteVehicle);});
    $('#catalogSearch').addEventListener('input',renderCatalogAdmin); $('#newCatalogVehicleBtn').addEventListener('click',()=>openCatalogForm());
    $('#catalogAdminList').addEventListener('click',e=>{const btn=e.target.closest('[data-edit-catalog]');if(btn)openCatalogForm(btn.dataset.editCatalog);});

    $('#inviteAdvisorBtn').addEventListener('click',openAdvisorModal); $('#advisorForm').addEventListener('submit',inviteAdvisor); $('#generateAdvisorPasswordBtn').addEventListener('click',()=>{$('#advisorPassword').value=generateTempPassword();});
    $('#bulkReassignBtn').addEventListener('click',bulkReassignClients); $('#refreshTrashBtn').addEventListener('click',loadTrash); $('#trashList').addEventListener('click',e=>{const btn=e.target.closest('[data-trash-restore]');if(btn)restoreTrash(btn.dataset.trashRestore,btn.dataset.trashId);});
    $$('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
  }

  function generateTempPassword() {
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    const bytes=new Uint32Array(12); crypto.getRandomValues(bytes); return [...bytes].map(v=>chars[v%chars.length]).join('');
  }

  function openAdvisorModal() {
    $('#advisorForm').reset(); $('#advisorPassword').value=generateTempPassword(); openModal('advisorModal');
  }

  async function inviteAdvisor(event) {
    event?.preventDefault();
    const email=$('#advisorEmail').value.trim(),full_name=$('#advisorName').value.trim(),password=$('#advisorPassword').value;
    if(!email||!full_name||password.length<8)return showToast('Completa nombre, correo y una contraseña de al menos 8 caracteres.','error');
    try {
      const {data,error}=await db.functions.invoke('admin-create-user',{body:{email,full_name,password}});
      if(error)throw error;
      showToast(data?.message||'Asesor creado.'); closeModal('advisorModal'); await loadAdvisors();
    } catch(error) {
      const msg=String(error?.message||'');
      showToast(msg.toLowerCase().includes('function')||msg.includes('404')?'Falta desplegar la Edge Function admin-create-user. Revisa la guía V2.4.':'No se pudo crear el asesor. Revisa la consola.','error');
      console.warn('[Autosale] inviteAdvisor:',error);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initTheme(); initEvents(); initTabs();
    updateChipGroup('chips-tasa', Number($('#tasa').value || 16), 'val');
    updateChipGroup('chips-anios', Number($('#anios').value || 5), 'val');
    updateChipGroup('chips-pct-inicial', 0, 'pct');
    calc(); await bootAuth();
  });
})();
