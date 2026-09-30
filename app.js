/* ================================================================
   AUTOSALE MOTORS · COTIZADOR + CRM · APP V2
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
  let selectedVehicle = null;
  let selectedClientId = '';
  let historyClientId = '';
  let initialPct = null;
  let priceBsModeQuote = 'tipo_cambio';
  let realtimeChannel = null;
  let settings = { tipo_cambio: 6.96, tasa_interes_default: 16, seguro_desgravamen: INSURANCE_DEFAULT };
  let lastMonthlyUsd = 0;
  let lastMonthlyBs = 0;

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
  }

  async function loadVehicles() {
    if (!db) return;
    const { data, error } = await db.from('vehiculos').select('*').order('nombre');
    if (error) { console.error('[Autosale] vehículos:', error); return; }
    vehicles = data || [];
    try { localStorage.setItem(LOCAL_VEHICLES_KEY, JSON.stringify(vehicles)); } catch (_) {}
    renderVehicleSearch();
    renderVehicleAdmin();
    renderCatalogAdmin();
    populateVehicleSelects();
    updateSelectedVehicleAfterSync();
  }

  async function loadClients() {
    if (!db) return;
    let query = db.from('clientes').select('*, vehiculo:vehiculos(id,nombre), permuta:cliente_permutas(id,estado_revision,marca,modelo)').order('updated_at', { ascending: false });
    if (profile.role !== 'admin') query = query.eq('asesor_id', session.user.id);
    const { data, error } = await query;
    if (error) { console.error('[Autosale] clientes:', error); return; }
    clients = data || [];
    renderClients(); renderClientSelect(); populateFollowupClients(); if (profile.role === 'admin') renderDashboard();
  }

  async function loadAdvisors() {
    if (profile.role !== 'admin') return;
    const { data, error } = await db.from('profiles').select('id,full_name,role,active,created_at').eq('role', 'asesor').order('full_name');
    if (!error) advisors = data || [];
    renderAdvisors(); populateAdvisorSelect();
  }

  async function loadFollowups() {
    if (!db) return;
    let query = db.from('seguimientos').select('*, cliente:clientes(id,nombre_completo,celular), asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)').order('programado_para', { ascending: true, nullsFirst: false });
    if (profile.role !== 'admin') query = query.eq('asesor_id', session.user.id);
    const { data, error } = await query;
    if (!error) followups = data || [];
    renderFollowups(); if (profile.role === 'admin') renderDashboard();
  }

  async function loadAllData() {
    await Promise.all([loadSettings(), loadVehicles(), loadClients(), loadFollowups(), loadAdvisors()]);
    renderDashboard();
  }

  function initRealtime() {
    if (realtimeChannel || !db || !session) return;
    realtimeChannel = db.channel(`autosale-live-vehicles-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehiculos' }, async () => { await loadVehicles(); showToast('Catálogo actualizado.'); })
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
    $('#precio').value = Number(vehicle.precio || 0);
    const bs = vehicleBsPrice(vehicle);
    $('#precioBs').value = Math.round(bs);
    priceBsModeQuote = vehicle.precio_bs_modo === 'manual' ? 'manual' : 'tipo_cambio';
    const currentInitial = Number($('#inicial').value || 0);
    if (initialPct !== null) {
      $('#inicial').value = Math.round(Number(vehicle.precio || 0) * initialPct / 100);
    } else if (currentInitial > Number(vehicle.precio || 0)) {
      $('#inicial').value = Number(vehicle.precio || 0);
    }
    updateFinanceFromPrice();
    updateSelectedVehicleUI();
    $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible');
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
  }

  function currentTc() { return Number($('#tc').value || settings.tipo_cambio || 0); }
  function effectivePriceBs() { return priceBsModeQuote === 'manual' ? Number($('#precioBs').value || 0) : Number($('#precio').value || 0) * currentTc(); }

  function clamp(value, min, max) { return Math.min(Math.max(Number(value || 0), min), max); }
  function currentInitialPct() {
    const priceUsd = Number($('#precio').value || 0);
    const priceBs = effectivePriceBs();
    if (initialPct !== null && Number.isFinite(initialPct)) return clamp(initialPct, 0, 100);
    const initialUsd = Number($('#inicial').value || 0);
    const initialBs = Number($('#inicialBs')?.value || 0);
    if (priceUsd > 0 && initialUsd >= 0) return clamp(initialUsd / priceUsd * 100, 0, 100);
    if (priceBs > 0 && initialBs >= 0) return clamp(initialBs / priceBs * 100, 0, 100);
    return 0;
  }

  function syncFinanceByPct(pct) {
    const safePct = clamp(pct, 0, 100);
    const priceUsd = Number($('#precio').value || 0);
    const priceBs = effectivePriceBs();
    initialPct = safePct;
    $('#inicial').value = Math.round(priceUsd * safePct / 100);
    $('#inicialBs').value = Math.round(priceBs * safePct / 100);
    $('#monto').value = Math.round(Math.max(0, priceUsd - Number($('#inicial').value || 0)));
    $('#montoBs').value = Math.round(Math.max(0, priceBs - Number($('#inicialBs').value || 0)));
    updateChipGroup('chips-pct-inicial', safePct, 'pct');
    calc();
  }

  function syncFromInitialUsd() {
    const price = Number($('#precio').value || 0);
    const initial = clamp($('#inicial').value, 0, price);
    $('#inicial').value = Math.round(initial);
    syncFinanceByPct(price > 0 ? initial / price * 100 : 0);
  }

  function syncFromInitialBs() {
    const priceBs = effectivePriceBs();
    const initialBs = clamp($('#inicialBs').value, 0, priceBs);
    $('#inicialBs').value = Math.round(initialBs);
    syncFinanceByPct(priceBs > 0 ? initialBs / priceBs * 100 : 0);
  }

  function syncFromAmountUsd() {
    const price = Number($('#precio').value || 0);
    const amount = clamp($('#monto').value, 0, price);
    const pctInitial = price > 0 ? (price - amount) / price * 100 : 0;
    syncFinanceByPct(pctInitial);
  }

  function syncFromAmountBs() {
    const priceBs = effectivePriceBs();
    const amountBs = clamp($('#montoBs').value, 0, priceBs);
    const pctInitial = priceBs > 0 ? (priceBs - amountBs) / priceBs * 100 : 0;
    syncFinanceByPct(pctInitial);
  }

  function updateFinanceFromPrice() {
    const price = Number($('#precio').value || 0);
    if (priceBsModeQuote !== 'manual') $('#precioBs').value = Math.round(price * currentTc());
    syncFinanceByPct(currentInitialPct());
  }

  function payment(principal, monthlyRate, periods) {
    const p = Number(principal || 0);
    if (p <= 0 || periods <= 0) return 0;
    if (monthlyRate <= 0) return p / periods;
    const pow = Math.pow(1 + monthlyRate, periods);
    return p * (monthlyRate * pow) / (pow - 1);
  }

  function calc() {
    const priceBs = effectivePriceBs();
    const amountUsd = Number($('#monto').value || 0);
    const amountBs = Number($('#montoBs')?.value || 0);
    const rate = Number($('#tasa').value || 0);
    const years = Number($('#anios').value || 0);
    if (amountUsd <= 0 || amountBs <= 0 || rate < 0 || years <= 0 || priceBs <= 0) {
      lastMonthlyUsd = 0; lastMonthlyBs = 0;
      $('#resUSD').textContent = '$ 0'; $('#resBOB').textContent = 'Bs 0'; return;
    }
    const totalRate = rate + Number(settings.seguro_desgravamen || INSURANCE_DEFAULT);
    const n = years * 12;
    const i = (totalRate / 100) / 12;
    lastMonthlyUsd = Math.round(payment(amountUsd, i, n));
    lastMonthlyBs = Math.round(payment(amountBs, i, n));
    $('#resUSD').textContent = moneyUSD(lastMonthlyUsd);
    $('#resBOB').textContent = moneyBs(lastMonthlyBs);
  }

  function selectInitialPct(pct) { syncFinanceByPct(pct); }

  function updateChipGroup(id, value, attr) {
    document.querySelectorAll(`#${id} .cotizador__chip`).forEach((chip) => {
      chip.classList.toggle('cotizador__chip--active', Math.abs(Number(chip.dataset[attr === 'pct' ? 'pct' : 'val']) - Number(value)) < 0.11);
    });
  }

  function selectChip(inputId, value) { $(`#${inputId}`).value = value; updateChipGroup(`chips-${inputId}`, value, 'val'); calc(); }

  function resetQuote() {
    selectedVehicle = null; initialPct = null; priceBsModeQuote = 'tipo_cambio'; lastMonthlyUsd = 0; lastMonthlyBs = 0;
    $('#buscarVehiculo').value = ''; $('#precio').value = 0; $('#precioBs').value = 0; $('#inicial').value = 0; $('#inicialBs').value = 0; $('#monto').value = 0; $('#montoBs').value = 0;
    $('#resUSD').textContent = '$ 0'; $('#resBOB').textContent = 'Bs 0';
    $('#quoteSaveStatus').textContent = '';
    updateSelectedVehicleUI(); updateChipGroup('chips-pct-inicial', -1, 'pct'); calc();
  }

  // --------------------------------------------------------------
  // Guardar cotizaciones
  // --------------------------------------------------------------
  function buildQuoteMessage() {
    const tc = currentTc();
    const price = Number($('#precio').value || 0);
    const priceBs = effectivePriceBs();
    const initial = Number($('#inicial').value || 0);
    const amount = Number($('#monto').value || 0);
    const initialBs = Number($('#inicialBs').value || 0);
    const amountBs = Number($('#montoBs').value || 0);
    const tasa = $('#tasa').value;
    const years = $('#anios').value;
    let msg = `🚗 *AUTOSALE MOTORS - FINANCIAMIENTO BANCARIO*\n\n`;
    if (selectedVehicle?.nombre) msg += `🚘 *Vehículo: ${selectedVehicle.nombre}*\n\n`;
    if (selectedClientId) {
      const client = clients.find(c => c.id === selectedClientId);
      if (client?.nombre_completo) msg += `👤 *Cliente: ${client.nombre_completo}*\n\n`;
    }
    msg += `• Tipo de Cambio: Bs ${tc}\n`;
    msg += `• Precio: ${moneyUSD(price)} (${moneyBs(priceBs)})\n`;
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
    try {
      await navigator.clipboard.writeText(msg);
      showToast('Cotización copiada para WhatsApp.');
    } catch (_) {
      const textArea = document.createElement('textarea');
      textArea.value = msg; textArea.style.position='fixed'; textArea.style.opacity='0';
      document.body.appendChild(textArea); textArea.focus(); textArea.select();
      try { document.execCommand('copy'); showToast('Cotización copiada para WhatsApp.'); }
      catch (error) { showToast('No se pudo copiar la cotización.', 'error'); }
      document.body.removeChild(textArea);
    }
  }

  async function saveQuote() {
    if (!db || !session) return;
    const price = Number($('#precio').value || 0);
    if (price <= 0) return showToast('Ingresa un precio antes de guardar.', 'error');
    const payload = {
      cliente_id: selectedClientId || null,
      asesor_id: profile.role === 'admin' ? (selectedClientId ? (clients.find(c => c.id === selectedClientId)?.asesor_id || session.user.id) : session.user.id) : session.user.id,
      vehiculo_id: selectedVehicle?.id || null,
      vehiculo_nombre: selectedVehicle?.nombre || $('#buscarVehiculo').value.trim(),
      precio_usd: price,
      precio_bs: effectivePriceBs(),
      cuota_inicial_usd: Number($('#inicial').value || 0),
      monto_financiado_usd: Number($('#monto').value || 0),
      tasa_interes: Number($('#tasa').value || 0),
      seguro_desgravamen: Number(settings.seguro_desgravamen || 0),
      plazo_anios: Number($('#anios').value || 0),
      cuota_mensual_usd: lastMonthlyUsd,
      cuota_mensual_bs: lastMonthlyBs,
      notas: ''
    };
    const { data, error } = await db.from('cotizaciones').insert(payload).select('numero').single();
    if (error) { console.error(error); return showToast('No se pudo guardar la cotización.', 'error'); }
    $('#quoteSaveStatus').textContent = `Guardada como #${data.numero}`;
    showToast(`Cotización #${data.numero} guardada.`);
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
  function populateAdvisorSelect() {
    const select = $('#clientAdvisor'); if (!select) return;
    const self = { id: session.user.id, full_name: profile.full_name || 'Administrador', role: profile.role };
    const all = profile.role === 'admin' ? [self, ...advisors.filter(a => a.id !== self.id)] : [self];
    select.innerHTML = all.map(a => `<option value="${a.id}">${escapeHtml(a.full_name || a.id)}${a.id === self.id && profile.role === 'admin' ? ' (yo)' : ''}</option>`).join('');
    select.value = session.user.id;
  }

  function clientCard(c) {
    const tradeinBadge = c.permuta ? `<span class="status-badge status-badge--warning">Permuta · ${escapeHtml(c.permuta.estado_revision || 'pendiente')}</span>` : '';
    return `<article class="crm-card" data-client-id="${c.id}">
      <div class="crm-card__main"><div class="crm-card__title-row"><h3>${escapeHtml(c.nombre_completo)}</h3><span class="status-badge">${escapeHtml(quoteStatusLabel(c.estado))}</span></div>
      <p>${escapeHtml(c.celular)}${c.vehiculo?.nombre ? ` · ${escapeHtml(c.vehiculo.nombre)}` : ''} ${tradeinBadge}</p><small>${escapeHtml(purchaseModeLabel(c.modo_compra))} · ${escapeHtml(c.origen || 'Otro')}</small></div>
      <div class="crm-card__actions">
        <button class="modal__secondary" type="button" data-client-edit="${c.id}">Ver / editar</button>
        <button class="modal__secondary" type="button" data-client-quotes="${c.id}">Cotizaciones</button>
        <button class="modal__primary" type="button" data-client-followups="${c.id}">Seguimientos</button>
      </div>
    </article>`;
  }

  function renderClients() {
    const list = $('#clientsList'); if (!list) return;
    const q = normalizeText($('#clientSearch')?.value || '');
    const status = $('#clientStatusFilter')?.value || '';
    const filtered = clients.filter(c => (!status || c.estado === status) && (!q || normalizeText(c.nombre_completo).includes(q) || normalizeText(c.celular).includes(q)));
    list.innerHTML = filtered.length ? filtered.map(clientCard).join('') : '<div class="empty-state">No hay clientes con estos filtros.</div>';
  }

  function syncClientConditionalFields() {
    const originOther = $('#clientOrigin')?.value === 'Otro';
    if ($('#clientOriginOtherField')) $('#clientOriginOtherField').hidden = !originOther;
    const lost = $('#clientStatus')?.value === 'perdido';
    if ($('#clientLostReasonField')) $('#clientLostReasonField').hidden = !lost;
    const lostOther = lost && $('#clientLostReason')?.value === 'Otro';
    if ($('#clientLostReasonOtherField')) $('#clientLostReasonOtherField').hidden = !lostOther;
  }

  async function openClient(clientId = '') {
    const existing = clients.find(c => String(c.id) === String(clientId));
    $('#clientId').value = existing?.id || '';
    $('#clientModalTitle').textContent = existing ? 'Editar cliente' : 'Nuevo cliente';
    $('#clientName').value = existing?.nombre_completo || '';
    $('#clientPhone').value = existing?.celular || '';

    const origin = existing?.origen || 'Facebook';
    if (CLIENT_ORIGINS.includes(origin)) {
      $('#clientOrigin').value = origin;
      $('#clientOriginOther').value = '';
    } else {
      $('#clientOrigin').value = 'Otro';
      $('#clientOriginOther').value = origin === 'Otro' ? '' : origin;
    }

    $('#clientVehicle').value = existing?.vehiculo_interes_id || '';
    const allowedModes = ['contado','garante_personal','hipotecario_vehicular','hipotecado_inmueble'];
    $('#clientPurchaseMode').value = allowedModes.includes(existing?.modo_compra) ? existing.modo_compra : '';
    const allowedStatuses = ['en_seguimiento','vendido','perdido','esperando_credito'];
    $('#clientStatus').value = allowedStatuses.includes(existing?.estado) ? existing.estado : 'en_seguimiento';

    const lostReason = existing?.motivo_perdida || '';
    if (!lostReason) {
      $('#clientLostReason').value = '';
      $('#clientLostReasonOther').value = '';
    } else if (LOST_REASONS.includes(lostReason)) {
      $('#clientLostReason').value = lostReason;
      $('#clientLostReasonOther').value = '';
    } else {
      $('#clientLostReason').value = 'Otro';
      $('#clientLostReasonOther').value = lostReason === 'Otro' ? '' : lostReason;
    }
    $('#clientNotes').value = existing?.notas || '';

    $('#clientVisitTitle').textContent = existing ? 'Registrar nueva visita (opcional)' : 'Registrar visita inicial';
    $('#clientVisitDate').value = existing ? '' : new Date().toISOString().slice(0, 10);
    $('#clientVisitNote').value = '';

    const trade = existing?.permuta || null;
    $('#clientHasTradein').checked = Boolean(trade);
    $('#tradeinFields').hidden = !trade;
    $('#tradeBrand').value = trade?.marca || '';
    $('#tradeModel').value = trade?.modelo || '';
    $('#tradeYear').value = trade?.anio || '';
    $('#tradePlate').value = trade?.placa || '';
    $('#tradeEngine').value = trade?.motor || '';
    $('#tradeFuel').value = trade?.combustible || '';
    $('#tradeEstimated').value = trade?.valor_estimado ?? '';
    $('#tradeReview').value = ['pendiente','revisado','rechazado'].includes(trade?.estado_revision) ? trade.estado_revision : 'pendiente';

    populateAdvisorSelect();
    $('#clientAdvisor').value = existing?.asesor_id || session.user.id;
    syncClientConditionalFields();
    openModal('clientModal');
  }

  async function saveClient(event) {
    event.preventDefault();
    const id = $('#clientId').value;
    let advisorId = $('#clientAdvisor').value || session.user.id;
    if (profile.role !== 'admin') advisorId = session.user.id;

    const originChoice = $('#clientOrigin').value;
    const origin = originChoice === 'Otro' ? ($('#clientOriginOther').value.trim() || 'Otro') : originChoice;
    const lost = $('#clientStatus').value === 'perdido';
    const lostChoice = $('#clientLostReason').value;
    const lostReason = !lost ? null : (lostChoice === 'Otro' ? ($('#clientLostReasonOther').value.trim() || 'Otro') : (lostChoice || null));

    const payload = {
      nombre_completo: $('#clientName').value.trim(),
      celular: $('#clientPhone').value.trim(),
      whatsapp: null,
      origen,
      vehiculo_interes_id: $('#clientVehicle').value || null,
      modo_compra: $('#clientPurchaseMode').value || null,
      presupuesto_usd: null,
      estado: $('#clientStatus').value,
      motivo_perdida: lostReason,
      notas: $('#clientNotes').value.trim(),
      asesor_id: advisorId,
      creado_por: id ? undefined : session.user.id
    };
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
    const result = id
      ? await db.from('clientes').update(payload).eq('id', id).select('*').single()
      : await db.from('clientes').insert(payload).select('*').single();
    if (result.error) return showToast(result.error.message, 'error');
    const clientId = result.data.id;

    const visitDate = $('#clientVisitDate').value;
    const visitNote = $('#clientVisitNote').value.trim();
    if (visitDate) {
      const visitResult = await db.from('cliente_visitas').insert({ cliente_id: clientId, fecha: visitDate, notas: visitNote, creado_por: session.user.id });
      if (visitResult.error) console.warn('[Autosale] visita:', visitResult.error.message);
    }

    const hasTrade = $('#clientHasTradein').checked;
    if (hasTrade) {
      const tradePayload = {
        cliente_id: clientId,
        marca: $('#tradeBrand').value.trim(),
        modelo: $('#tradeModel').value.trim(),
        anio: $('#tradeYear').value ? Number($('#tradeYear').value) : null,
        placa: $('#tradePlate').value.trim() || null,
        motor: $('#tradeEngine').value.trim() || null,
        combustible: $('#tradeFuel').value.trim() || null,
        valor_estimado: $('#tradeEstimated').value ? Number($('#tradeEstimated').value) : null,
        estado_revision: $('#tradeReview').value
      };
      const tradeResult = await db.from('cliente_permutas').upsert(tradePayload, { onConflict: 'cliente_id' });
      if (tradeResult.error) console.warn('[Autosale] permuta:', tradeResult.error.message);
    } else if (id) {
      const tradeResult = await db.from('cliente_permutas').delete().eq('cliente_id', clientId);
      if (tradeResult.error) console.warn('[Autosale] eliminar permuta:', tradeResult.error.message);
    }

    closeModal('clientModal'); await loadClients();
    showToast(id ? 'Cliente actualizado.' : 'Cliente creado.');
  }

  async function openClientQuotes(clientId) {
    const client = clients.find(c => String(c.id) === String(clientId));
    historyClientId = clientId;
    $('#clientQuotesTitle').textContent = `Cotizaciones · ${client?.nombre_completo || 'Cliente'}`;
    const list = $('#clientQuotesList');
    list.innerHTML = '<div class="empty-state">Cargando cotizaciones…</div>';
    openModal('clientQuotesModal');
    const { data, error } = await db.from('cotizaciones')
      .select('numero,vehiculo_nombre,precio_usd,precio_bs,cuota_inicial_usd,monto_financiado_usd,tasa_interes,plazo_anios,cuota_mensual_usd,cuota_mensual_bs,created_at')
      .eq('cliente_id', clientId).order('created_at', { ascending: false });
    if (error) { list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; return; }
    list.innerHTML = data?.length ? data.map(q => `<article class="history-card">
      <div class="history-card__head"><div><span class="cotizador__tag">#${q.numero}</span><h3>${escapeHtml(q.vehiculo_nombre || 'Sin vehículo')}</h3></div><time>${new Date(q.created_at).toLocaleString('es-BO')}</time></div>
      <div class="history-card__grid">
        <div><span>Precio</span><strong>${moneyUSD(q.precio_usd)} · ${moneyBs(q.precio_bs)}</strong></div>
        <div><span>Inicial</span><strong>${moneyUSD(q.cuota_inicial_usd)}</strong></div>
        <div><span>Financiado</span><strong>${moneyUSD(q.monto_financiado_usd)}</strong></div>
        <div><span>Plazo</span><strong>${Number(q.plazo_anios || 0)} años · ${Number(q.tasa_interes || 0)}%</strong></div>
        <div class="history-card__highlight"><span>Cuota mensual</span><strong>${moneyUSD(q.cuota_mensual_usd)} · ${moneyBs(q.cuota_mensual_bs)}</strong></div>
      </div>
    </article>`).join('') : '<div class="empty-state">Este cliente todavía no tiene cotizaciones guardadas.</div>';
  }

  async function openClientFollowupsHistory(clientId) {
    const client = clients.find(c => String(c.id) === String(clientId));
    historyClientId = clientId;
    $('#clientFollowupsTitle').textContent = `Seguimientos · ${client?.nombre_completo || 'Cliente'}`;
    const list = $('#clientFollowupsHistoryList');
    list.innerHTML = '<div class="empty-state">Cargando seguimientos…</div>';
    openModal('clientFollowupsModal');
    const { data, error } = await db.from('seguimientos')
      .select('id,tipo,programado_para,estado,notas,completado_at,created_at,asesor:profiles!seguimientos_asesor_id_fkey(id,full_name)')
      .eq('cliente_id', clientId).order('created_at', { ascending: false });
    if (error) { list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; return; }
    list.innerHTML = data?.length ? data.map(f => followupHistoryCard(f)).join('') : '<div class="empty-state">Este cliente todavía no tiene seguimientos registrados.</div>';
  }

  // --------------------------------------------------------------
  // Seguimientos
  // --------------------------------------------------------------
  function populateFollowupClients() {
    const html = clients.map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('');
    $('#followupClient').innerHTML = html;
  }

  function followupHistoryCard(f) {
    const date = f.programado_para ? new Date(f.programado_para).toLocaleString('es-BO') : 'Sin fecha programada';
    const created = f.created_at ? new Date(f.created_at).toLocaleString('es-BO') : '';
    const completed = f.completado_at ? new Date(f.completado_at).toLocaleString('es-BO') : '';
    return `<article class="history-card history-card--followup">
      <div class="history-card__head"><div><span class="status-badge">${escapeHtml(f.tipo || 'Seguimiento')}</span><h3>${escapeHtml(f.cliente?.nombre_completo || 'Seguimiento')}</h3></div><span class="status-badge ${f.estado === 'completado' ? 'status-badge--done' : ''}">${f.estado === 'completado' ? 'Completado' : 'Pendiente'}</span></div>
      <div class="history-card__followup-date">${escapeHtml(date)}</div>
      ${f.notas ? `<p>${escapeHtml(f.notas)}</p>` : ''}
      <small>Registrado: ${escapeHtml(created)}${completed ? ` · Completado: ${escapeHtml(completed)}` : ''}${f.asesor?.full_name ? ` · ${escapeHtml(f.asesor.full_name)}` : ''}</small>
    </article>`;
  }

  function renderFollowups() {
    const list = $('#followupsList'); if (!list) return;
    const filter = $('#followupFilter')?.value || '';
    const q = normalizeText($('#followupSearch')?.value || '');
    const rows = followups.filter(f => (!filter || f.estado === filter) && (!q || normalizeText(f.cliente?.nombre_completo || '').includes(q)));
    list.innerHTML = rows.length ? rows.map(f => `<article class="crm-card"><div class="crm-card__main"><div class="crm-card__title-row"><h3>${escapeHtml(f.cliente?.nombre_completo || 'Cliente')}</h3><span class="status-badge">${escapeHtml(f.tipo)}</span><span class="status-badge ${f.estado === 'completado' ? 'status-badge--done' : ''}">${f.estado === 'completado' ? 'Completado' : 'Pendiente'}</span></div><p>${f.programado_para ? new Date(f.programado_para).toLocaleString('es-BO') : 'Sin fecha programada'}</p><small>${escapeHtml(f.notas || 'Sin notas')}${f.created_at ? ` · Registrado ${new Date(f.created_at).toLocaleDateString('es-BO')}` : ''}</small></div><div class="crm-card__actions"><button class="modal__secondary" type="button" data-followup-history-client="${f.cliente_id}">Ver historial</button><button class="modal__secondary" type="button" data-followup-complete="${f.id}">${f.estado === 'completado' ? 'Reabrir' : 'Completar'}</button></div></article>`).join('') : '<div class="empty-state">No hay seguimientos para estos filtros.</div>';
  }

  function openFollowup(clientId = '') {
    $('#followupClient').value = clientId || clients[0]?.id || '';
    $('#followupType').value = 'Llamada';
    $('#followupDate').value = new Date(Date.now() + 86400000).toISOString().slice(0,16);
    $('#followupNotes').value = '';
    openModal('followupModal');
  }

  async function saveFollowup(event) {
    event.preventDefault();
    const clientId = $('#followupClient').value;
    if (!clientId) return showToast('Selecciona un cliente.', 'error');
    const client = clients.find(c => c.id === clientId);
    const payload = { cliente_id: clientId, asesor_id: profile.role === 'admin' ? (client?.asesor_id || session.user.id) : session.user.id, tipo: $('#followupType').value, programado_para: $('#followupDate').value || null, estado: 'pendiente', notas: $('#followupNotes').value.trim(), creado_por: session.user.id };
    const { error } = await db.from('seguimientos').insert(payload);
    if (error) return showToast(error.message, 'error');
    closeModal('followupModal'); await loadFollowups(); showToast('Seguimiento creado.');
  }

  async function toggleFollowup(id) {
    const item = followups.find(f => f.id === id); if (!item) return;
    const completed = item.estado !== 'completado';
    const { error } = await db.from('seguimientos').update({ estado: completed ? 'completado' : 'pendiente', completado_at: completed ? new Date().toISOString() : null }).eq('id', id);
    if (error) return showToast(error.message, 'error');
    await loadFollowups(); showToast(completed ? 'Seguimiento completado.' : 'Seguimiento reabierto.');
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
    settings = { ...settings, ...payload }; $('#tc').value=settings.tipo_cambio; $('#tasa').value=settings.tasa_interes_default; calc(); showToast('Configuración guardada.');
  }
  function renderAdvisors() {
    if (!$('#advisorsList')) return;
    $('#advisorsList').innerHTML = advisors.length ? advisors.map(a => {
      const advisorClients = clients.filter(c => c.asesor_id === a.id);
      const advisorFollowups = followups.filter(f => f.asesor_id === a.id && f.estado === 'pendiente');
      return `<div class="simple-list__row"><div><strong>${escapeHtml(a.full_name || 'Sin nombre')}</strong><span>${a.active ? 'Activo' : 'Inactivo'} · ${advisorClients.length} clientes · ${advisorFollowups.length} seguimientos pendientes</span></div><span>Asesor</span></div>`;
    }).join('') : '<div class="empty-state">No hay asesores registrados.</div>';
  }
  async function renderAudit() {
    if (profile.role !== 'admin') return;
    const { data } = await db.from('auditoria').select('*, actor:profiles(full_name)').order('created_at', { ascending:false }).limit(12);
    $('#auditList').innerHTML = data?.length ? data.map(a => `<div class="simple-list__row"><div><strong>${escapeHtml(a.actor?.full_name || 'Sistema')} · ${escapeHtml(a.accion)}</strong><span>${escapeHtml(a.tabla)}</span></div><time>${new Date(a.created_at).toLocaleString('es-BO')}</time></div>`).join('') : '<div class="empty-state">Sin actividad todavía.</div>';
  }
  function renderDashboard() {
    if (profile.role !== 'admin') return;
    $('#settingTc').value=settings.tipo_cambio; $('#settingRate').value=settings.tasa_interes_default; $('#settingInsurance').value=settings.seguro_desgravamen;
    $('#adminVehicleSummary').innerHTML = `<div class="metric"><strong>${vehicles.length}</strong><span>Vehículos</span></div><div class="metric"><strong>${vehicles.filter(v=>v.public_published).length}</strong><span>Publicados</span></div><div class="metric"><strong>${clients.length}</strong><span>Clientes visibles</span></div><div class="metric"><strong>${followups.filter(f=>f.estado==='pendiente').length}</strong><span>Seguimientos pendientes</span></div>`;
    renderAudit();
    renderAdvisors();
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
    list.innerHTML = rows.length ? rows.map(v => `<article class="catalog-admin-card"><div class="catalog-admin-card__image">${v.public_image_url ? `<img src="${escapeHtml(v.public_image_url)}" alt="${escapeHtml(publicName(v) || v.nombre)}">` : '<span>Sin imagen</span>'}</div><div class="catalog-admin-card__body"><div class="catalog-admin-card__status"><span class="status-badge">${v.public_published ? 'Publicado' : 'Borrador'}</span>${v.public_featured ? '<span class="status-badge status-badge--warning">Destacado</span>' : ''}</div><h3>${escapeHtml(publicName(v) || v.nombre)}</h3><p>${escapeHtml(v.public_engine || 'Motor por definir')}</p><button class="modal__secondary" type="button" data-edit-catalog="${v.id}">Editar ficha</button></div></article>`).join('') : '<div class="empty-state">No hay vehículos.</div>';
  }

  function openCatalogForm(id='') {
    const v = vehicles.find(x=>String(x.id)===String(id));
    $('#catalogVehicleId').value = v?.id || '';
    $('#catalogInternalName').value = v?.nombre || '';
    $('#catalogImageFile').value = '';
    $('#catalogGalleryFiles').value = '';
    $('#catalogInternalPrice').value = v?.precio ?? 0;
    $('#catalogInternalPriceBs').value = v?.precio_bs_manual ?? '';
    $('#catalogInternalPriceBsMode').value = v?.precio_bs_modo || 'tipo_cambio';
    $('#catalogBrand').value = v?.public_brand || '';
    $('#catalogModel').value = v?.public_model || '';
    $('#catalogVersion').value = v?.public_version || '';
    $('#catalogClass').value = v?.public_class || 'minibus';
    $('#catalogEngine').value = v?.public_engine || '';
    $('#catalogStatus').value = v?.public_status || 'nuevo';
    $('#catalogVariant').value = v?.public_variant || '';
    $('#catalogImage').value = v?.public_image_url || '';
    $('#catalogDescription').value = v?.public_description || '';
    $('#catalogGallery').value = Array.isArray(v?.public_gallery_urls) ? v.public_gallery_urls.join('\n') : '';
    $('#catalogVideo').value = v?.public_video_url || '';
    $('#catalogSlug').value = v?.public_slug || '';
    $('#catalogPublished').checked = Boolean(v?.public_published);
    $('#catalogFeatured').checked = Boolean(v?.public_featured);
    $('#catalogNew').checked = Boolean(v?.public_new);
    $('#catalogModalTitle').textContent = v ? 'Editar ficha de vehículo' : 'Nueva ficha de vehículo';
    openModal('catalogModal');
  }

  async function saveCatalog(event) {
    event.preventDefault();
    const id = $('#catalogVehicleId').value;
    let publicGallery = $('#catalogGallery').value.split('\n').map(s => s.trim()).filter(Boolean);
    const mainFile = $('#catalogImageFile').files?.[0];
    const galleryFiles = [...($('#catalogGalleryFiles').files || [])];
    try {
      if (mainFile) {
        const uploadedMain = await uploadCatalogFile(mainFile, 'vehiculos');
        if (uploadedMain) $('#catalogImage').value = uploadedMain;
      }
      if (galleryFiles.length) {
        const uploadedGallery = (await Promise.all(galleryFiles.map(file => uploadCatalogFile(file, 'vehiculos/gallery')))).filter(Boolean);
        publicGallery = [...publicGallery, ...uploadedGallery];
      }
    } catch (uploadError) {
      console.error('[Autosale] carga de imágenes:', uploadError);
      return showToast(`No se pudo subir una imagen: ${uploadError.message || 'error'}`, 'error');
    }
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
      public_video_url: $('#catalogVideo').value.trim() || null,
      public_slug: $('#catalogSlug').value.trim() || null,
      public_published: $('#catalogPublished').checked,
      public_featured: $('#catalogFeatured').checked,
      public_new: $('#catalogNew').checked
    };
    if (!publicPayload.public_brand) return showToast('La marca es obligatoria.', 'error');

    let result;
    if (id) {
      result = await db.from('vehiculos').update(publicPayload).eq('id', id);
    } else {
      const internalName = $('#catalogInternalName').value.trim() || [publicPayload.public_brand, publicPayload.public_model, publicPayload.public_version].filter(Boolean).join(' ');
      const insertPayload = {
        nombre: internalName,
        precio: Number($('#catalogInternalPrice').value || 0),
        precio_bs_manual: $('#catalogInternalPriceBs').value ? Number($('#catalogInternalPriceBs').value) : null,
        precio_bs_modo: $('#catalogInternalPriceBsMode').value,
        ...publicPayload
      };
      result = await db.from('vehiculos').insert(insertPayload);
    }
    if (result.error) return showToast(result.error.message, 'error');
    closeModal('catalogModal'); await loadVehicles(); showToast(id ? 'Ficha web guardada.' : 'Vehículo y ficha web creados.');
  }

  // --------------------------------------------------------------
  // Eventos
  // --------------------------------------------------------------
  function initEvents() {
    $('#loginForm').addEventListener('submit', login);
    $('#logoutBtn').addEventListener('click', logout);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $$('.app-tab').forEach(t => t.addEventListener('click', () => setTimeout(renderDashboard, 0)));
    $('#buscarVehiculo').addEventListener('input', renderVehicleSearch);
    $('#buscarVehiculo').addEventListener('focus', renderVehicleSearch);
    $('#buscarVehiculo').addEventListener('keydown', e => { if (e.key==='Escape') $('#resultadosVehiculos').classList.remove('vehicle-search__results--visible'); });
    $('#resultadosVehiculos').addEventListener('click', e => { const btn=e.target.closest('[data-id]'); if(btn) selectVehicle(btn.dataset.id); });
    $('#limpiarVehiculo').addEventListener('click', clearSelectedVehicle); $('#clearSelectedVehicle').addEventListener('click', clearSelectedVehicle);
    $('#tc').addEventListener('input', () => { if(priceBsModeQuote!=='manual') $('#precioBs').value=Math.round(Number($('#precio').value||0)*currentTc()); syncFinanceByPct(currentInitialPct()); });
    $('#precio').addEventListener('input', updateFinanceFromPrice);
    $('#precioBs').addEventListener('input', () => { priceBsModeQuote='manual'; syncFinanceByPct(currentInitialPct()); });
    $('#inicial').addEventListener('input', syncFromInitialUsd);
    $('#inicialBs').addEventListener('input', syncFromInitialBs);
    $('#monto').addEventListener('input', syncFromAmountUsd);
    $('#montoBs').addEventListener('input', syncFromAmountBs);
    $('#tasa').addEventListener('input', calc); $('#anios').addEventListener('input', calc);
    $('#chips-pct-inicial').addEventListener('click', e => { const chip=e.target.closest('[data-pct]'); if(chip) selectInitialPct(Number(chip.dataset.pct)); });
    $('#chips-tasa').addEventListener('click', e => { const chip=e.target.closest('[data-val]'); if(chip) selectChip('tasa', Number(chip.dataset.val)); });
    $('#chips-anios').addEventListener('click', e => { const chip=e.target.closest('[data-val]'); if(chip) selectChip('anios', Number(chip.dataset.val)); });
    $('#newQuoteBtn').addEventListener('click', resetQuote); $('#shareQuoteBtn').addEventListener('click', shareQuote); $('#saveQuoteBtn').addEventListener('click', saveQuote);
    $('#quoteClientSelect').addEventListener('change', e => { selectedClientId=e.target.value; });
    $('#quickClientBtn').addEventListener('click', () => openClient());
    $('#newClientBtn').addEventListener('click', () => openClient());
    $('#clientSearch').addEventListener('input', renderClients); $('#clientStatusFilter').addEventListener('change', renderClients);
    $('#clientsList').addEventListener('click', e => {
      const edit=e.target.closest('[data-client-edit]');
      const quotes=e.target.closest('[data-client-quotes]');
      const followupsBtn=e.target.closest('[data-client-followups]');
      if(edit) openClient(edit.dataset.clientEdit);
      if(quotes) openClientQuotes(quotes.dataset.clientQuotes);
      if(followupsBtn) openClientFollowupsHistory(followupsBtn.dataset.clientFollowups);
    });
    $('#followupFilter').addEventListener('change', renderFollowups);
    $('#followupSearch').addEventListener('input', renderFollowups);
    $('#newFollowupBtn').addEventListener('click', () => openFollowup());
    $('#followupsList').addEventListener('click', e => {
      const btn=e.target.closest('[data-followup-complete]');
      const history=e.target.closest('[data-followup-history-client]');
      if(btn) toggleFollowup(btn.dataset.followupComplete);
      if(history) openClientFollowupsHistory(history.dataset.followupHistoryClient);
    });
    $('#clientHistoryNewFollowupBtn').addEventListener('click', () => { const id=historyClientId; closeModal('clientFollowupsModal'); openFollowup(id); });
    $('#clientOrigin').addEventListener('change', syncClientConditionalFields);
    $('#clientStatus').addEventListener('change', syncClientConditionalFields);
    $('#clientLostReason').addEventListener('change', syncClientConditionalFields);
    $('#clientHasTradein').addEventListener('change', e => { $('#tradeinFields').hidden = !e.target.checked; });
    $('#clientForm').addEventListener('submit', saveClient); $('#followupForm').addEventListener('submit', saveFollowup); $('#settingsForm').addEventListener('submit', saveSettings); $('#vehicleForm').addEventListener('submit', saveVehicle); $('#catalogForm').addEventListener('submit', saveCatalog);
    $('#openVehicleAdminBtn').addEventListener('click', () => openVehicleAdmin()); $('#cancelVehicleBtn').addEventListener('click', resetVehicleForm);
    $('#adminVehicleList').addEventListener('click', e => { const edit=e.target.closest('[data-edit-vehicle]'); const del=e.target.closest('[data-delete-vehicle]'); if(edit) openVehicleAdmin(edit.dataset.editVehicle); if(del) deleteVehicle(del.dataset.deleteVehicle); });
    $('#catalogSearch').addEventListener('input', renderCatalogAdmin); $('#newCatalogVehicleBtn').addEventListener('click', () => openCatalogForm());
    $('#catalogAdminList').addEventListener('click', e => { const btn=e.target.closest('[data-edit-catalog]'); if(btn) openCatalogForm(btn.dataset.editCatalog); });
    $('#inviteAdvisorBtn').addEventListener('click', inviteAdvisor);
    $$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  }

  async function inviteAdvisor() {
    const email = prompt('Correo del nuevo asesor:'); if (!email) return;
    const name = prompt('Nombre del asesor:') || email.split('@')[0];
    try {
      const { data, error } = await db.functions.invoke('admin-create-user', { body: { email, full_name: name } });
      if (error) throw error;
      showToast(data?.message || 'Invitación enviada.'); await loadAdvisors();
    } catch (error) {
      showToast('La invitación necesita desplegar la Edge Function admin-create-user en Supabase.', 'error');
      console.warn('[Autosale] inviteAdvisor:', error);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initTheme(); initEvents(); initTabs(); calc(); await bootAuth();
  });
})();
