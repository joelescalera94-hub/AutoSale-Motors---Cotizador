/* ==========================================================================
   CONFIGURACIÓN GLOBAL
   ========================================================================== */
const SEGURO_DESGRAVAMEN = 1.00; // Ajustado al estándar bancario comercial
let pctInicialActivo = null;
let vehiculoSeleccionado = null;

/* ==========================================================================
   1. GESTIÓN DE TEMAS
   ========================================================================== */
function toggleTheme() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const themeBtn = document.getElementById('themeBtn');

  if (isDark) {
    document.body.removeAttribute('data-theme');
    themeBtn.innerText = '🌙';
    localStorage.setItem('theme', 'light');
  } else {
    document.body.setAttribute('data-theme', 'dark');
    themeBtn.innerText = '☀️';
    localStorage.setItem('theme', 'dark');
  }
}

function initTheme() {
  const themeBtn = document.getElementById('themeBtn');
  if (localStorage.getItem('theme') === 'light') {
    document.body.removeAttribute('data-theme');
    if (themeBtn) themeBtn.innerText = '🌙';
  } else {
    document.body.setAttribute('data-theme', 'dark');
    if (themeBtn) themeBtn.innerText = '☀️';
  }
}

/* ==========================================================================
   2. NOTIFICACIONES
   ========================================================================== */
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('toast--visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('toast--visible'), 2500);
}

/* ==========================================================================\n   3. GESTIÓN DE VEHÍCULOS · COMPARTIDA CON SUPABASE / FALLBACK LOCAL\n   ========================================================================== */
const VEHICULOS_STORAGE_KEY = 'autosale_vehiculos_v1';
const SUPABASE_CONFIG = window.AUTOSALE_SUPABASE || { url: '', anonKey: '' };
const SUPABASE_URL = String(SUPABASE_CONFIG.url || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(SUPABASE_CONFIG.anonKey || '');
const SUPABASE_ENABLED = /^https:\/\/[^\s]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
const VEHICULOS_ENDPOINT = SUPABASE_ENABLED ? `${SUPABASE_URL}/rest/v1/vehiculos` : '';
let vehiculosCompartidos = [];
let sincronizacionTimer = null;
let sincronizacionEnCurso = false;
let ultimoErrorSincronizacion = '';

function obtenerVehiculos() {
  return Array.isArray(vehiculosCompartidos) ? vehiculosCompartidos : [];
}

function obtenerVehiculosLocales() {
  try {
    const raw = localStorage.getItem(VEHICULOS_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(v => v && typeof v.nombre === 'string' && Number.isFinite(Number(v.precio)))
      .map(v => ({ ...v, precio: Number(v.precio) }));
  } catch (error) {
    return [];
  }
}

function guardarVehiculosLocales(vehiculos) {
  try {
    localStorage.setItem(VEHICULOS_STORAGE_KEY, JSON.stringify(vehiculos));
  } catch (error) {
    // El modo local es solo respaldo; no interrumpimos el cotizador.
  }
}

function actualizarEstadoSincronizacion(estado, texto) {
  const el = document.getElementById('vehiculosSyncStatus');
  if (!el) return;
  el.dataset.status = estado;
  el.textContent = texto;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseRequest(path = '', options = {}) {
  const response = await fetch(`${VEHICULOS_ENDPOINT}${path}`, {
    ...options,
    cache: 'no-store',
    headers: supabaseHeaders(options.headers || {})
  });

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch (error) {}
    const message = `Supabase ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`;
    throw new Error(message);
  }

  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function normalizarVehiculo(v) {
  return {
    id: String(v.id),
    nombre: String(v.nombre || '').trim(),
    precio: Number(v.precio),
    updated_at: v.updated_at || null,
    created_at: v.created_at || null
  };
}

function ordenarVehiculos(vehiculos) {
  return [...vehiculos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

function actualizarSeleccionTrasSincronizacion() {
  if (!vehiculoSeleccionado) return;
  const actualizado = vehiculosCompartidos.find(v => String(v.id) === String(vehiculoSeleccionado.id));
  if (!actualizado) {
    limpiarVehiculoSeleccionado();
    return;
  }
  vehiculoSeleccionado = { ...actualizado };
  actualizarVehiculoSeleccionadoUI();
}

async function cargarVehiculosCompartidos({ mostrarEstado = true } = {}) {
  if (!SUPABASE_ENABLED) {
    vehiculosCompartidos = ordenarVehiculos(obtenerVehiculosLocales());
    if (mostrarEstado) actualizarEstadoSincronizacion('local', '● Modo local · configura Supabase para compartir');
    renderListaVehiculos();
    renderResultadosVehiculos();
    return;
  }

  if (sincronizacionEnCurso) return;
  sincronizacionEnCurso = true;
  if (mostrarEstado) actualizarEstadoSincronizacion('loading', '● Sincronizando…');

  try {
    const data = await supabaseRequest('?select=id,nombre,precio,created_at,updated_at&order=nombre.asc');
    vehiculosCompartidos = ordenarVehiculos(data.map(normalizarVehiculo));

    // Migración única y conservadora: solo intenta subir los datos locales
    // si la tabla remota está vacía. La restricción UNIQUE evita duplicados.
    const locales = obtenerVehiculosLocales();
    if (!vehiculosCompartidos.length && locales.length) {
      try {
        await supabaseRequest('', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(locales.map(v => ({ nombre: v.nombre, precio: Number(v.precio) })))
        });
        const remotos = await supabaseRequest('?select=id,nombre,precio,created_at,updated_at&order=nombre.asc');
        vehiculosCompartidos = ordenarVehiculos(remotos.map(normalizarVehiculo));
      } catch (migrationError) {
        // Si otro asesor hizo la migración primero, simplemente recargamos.
        const remotos = await supabaseRequest('?select=id,nombre,precio,created_at,updated_at&order=nombre.asc');
        vehiculosCompartidos = ordenarVehiculos(remotos.map(normalizarVehiculo));
      }
    }

    guardarVehiculosLocales(vehiculosCompartidos);
    actualizarSeleccionTrasSincronizacion();
    ultimoErrorSincronizacion = '';
    actualizarEstadoSincronizacion('ok', '● Sincronizado para todos los asesores');
    renderListaVehiculos();
    renderResultadosVehiculos();
  } catch (error) {
    // Conservamos el último catálogo conocido para que el cotizador siga funcionando.
    if (!vehiculosCompartidos.length) vehiculosCompartidos = ordenarVehiculos(obtenerVehiculosLocales());
    actualizarEstadoSincronizacion('error', '● Sin conexión · usando datos guardados');
    if (ultimoErrorSincronizacion !== error.message) {
      console.warn('[Autosale] No se pudo sincronizar vehículos:', error.message);
      ultimoErrorSincronizacion = error.message;
    }
    renderListaVehiculos();
    renderResultadosVehiculos();
  } finally {
    sincronizacionEnCurso = false;
  }
}

function iniciarSincronizacionVehiculos() {
  cargarVehiculosCompartidos();
  if (!SUPABASE_ENABLED) return;
  clearInterval(sincronizacionTimer);
  sincronizacionTimer = setInterval(() => {
    if (!document.hidden) cargarVehiculosCompartidos({ mostrarEstado: false });
  }, 5000);
}

async function crearVehiculoRemoto(nombre, precio) {
  const data = await supabaseRequest('', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ nombre, precio })
  });
  return normalizarVehiculo(data[0]);
}

async function actualizarVehiculoRemoto(id, nombre, precio) {
  const data = await supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ nombre, precio })
  });
  if (!data.length) throw new Error('No se encontró el vehículo para actualizar.');
  return normalizarVehiculo(data[0]);
}

async function eliminarVehiculoRemoto(id) {
  await supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

function abrirGestionVehiculos() {
  const modal = document.getElementById('vehiculosModal');
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  renderListaVehiculos();
  cargarVehiculosCompartidos({ mostrarEstado: false });
  setTimeout(() => document.getElementById('vehiculoNombre')?.focus(), 50);
}

function cerrarGestionVehiculos() {
  const modal = document.getElementById('vehiculosModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  cancelarEdicionVehiculo();
}

function formatearPrecioUSD(precio) {
  return '$ ' + Number(precio || 0).toLocaleString('en-US');
}

function renderListaVehiculos() {
  const lista = document.getElementById('listaVehiculos');
  const count = document.getElementById('vehiculosCount');
  if (!lista) return;

  const vehiculos = obtenerVehiculos();
  if (count) count.textContent = vehiculos.length;

  if (!vehiculos.length) {
    lista.innerHTML = `
      <div class="vehicle-list__empty">
        <span>🚘</span>
        <strong>Aún no tienes vehículos guardados</strong>
        <small>Agrega el primero arriba y luego podrás buscarlo desde el cotizador.</small>
      </div>`;
    return;
  }

  lista.innerHTML = vehiculos.map(v => `
    <div class="vehicle-item" data-id="${escapeHtml(String(v.id))}">
      <div class="vehicle-item__info">
        <strong>${escapeHtml(v.nombre)}</strong>
        <span>${formatearPrecioUSD(v.precio)}</span>
      </div>
      <div class="vehicle-item__actions">
        <button type="button" class="vehicle-item__btn" onclick="editarVehiculo('${escapeJs(String(v.id))}')" title="Editar" aria-label="Editar ${escapeHtml(v.nombre)}">✎</button>
        <button type="button" class="vehicle-item__btn vehicle-item__btn--danger" onclick="eliminarVehiculo('${escapeJs(String(v.id))}')" title="Eliminar" aria-label="Eliminar ${escapeHtml(v.nombre)}">×</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeJs(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function resetFormularioVehiculo() {
  const form = document.getElementById('vehiculoForm');
  if (form) form.reset();
  document.getElementById('vehiculoEditId').value = '';
  document.getElementById('vehiculoGuardarBtn').textContent = 'Agregar vehículo';
  document.getElementById('vehiculoCancelarEdicion').hidden = true;
}

function cancelarEdicionVehiculo() {
  resetFormularioVehiculo();
}

function editarVehiculo(id) {
  const vehiculo = obtenerVehiculos().find(v => String(v.id) === String(id));
  if (!vehiculo) return;

  document.getElementById('vehiculoEditId').value = vehiculo.id;
  document.getElementById('vehiculoNombre').value = vehiculo.nombre;
  document.getElementById('vehiculoPrecio').value = vehiculo.precio;
  document.getElementById('vehiculoGuardarBtn').textContent = 'Guardar cambios';
  document.getElementById('vehiculoCancelarEdicion').hidden = false;
  document.getElementById('vehiculoNombre').focus();
}

async function eliminarVehiculo(id) {
  const vehiculo = obtenerVehiculos().find(v => String(v.id) === String(id));
  if (!vehiculo) return;
  if (!confirm(`¿Eliminar "${vehiculo.nombre}" de la lista de vehículos?`)) return;

  try {
    if (SUPABASE_ENABLED) {
      actualizarEstadoSincronizacion('loading', '● Eliminando…');
      await eliminarVehiculoRemoto(id);
    } else {
      guardarVehiculosLocales(obtenerVehiculos().filter(v => String(v.id) !== String(id)));
    }

    vehiculosCompartidos = vehiculosCompartidos.filter(v => String(v.id) !== String(id));
    if (vehiculoSeleccionado && String(vehiculoSeleccionado.id) === String(id)) limpiarVehiculoSeleccionado();
    guardarVehiculosLocales(vehiculosCompartidos);
    renderListaVehiculos();
    renderResultadosVehiculos();
    actualizarEstadoSincronizacion(SUPABASE_ENABLED ? 'ok' : 'local', SUPABASE_ENABLED ? '● Sincronizado para todos los asesores' : '● Modo local');
    showToast('Vehículo eliminado');
  } catch (error) {
    actualizarEstadoSincronizacion('error', '● No se pudo eliminar');
    console.warn('[Autosale] No se pudo eliminar vehículo:', error.message);
    showToast('No se pudo eliminar el vehículo');
  }
}

async function guardarVehiculoDesdeFormulario(event) {
  event.preventDefault();

  const nombre = document.getElementById('vehiculoNombre').value.trim();
  const precio = Number(document.getElementById('vehiculoPrecio').value);
  const editId = document.getElementById('vehiculoEditId').value;

  if (!nombre || !Number.isFinite(precio) || precio < 0) {
    showToast('Completa nombre y precio correctamente');
    return;
  }

  const nombreNormalizado = normalizarTexto(nombre);
  const duplicado = obtenerVehiculos().find(v =>
    String(v.id) !== String(editId) && normalizarTexto(v.nombre) === nombreNormalizado
  );
  if (duplicado) {
    showToast('Ya existe un vehículo con ese nombre');
    return;
  }

  const boton = document.getElementById('vehiculoGuardarBtn');
  boton.disabled = true;
  try {
    if (SUPABASE_ENABLED) {
      actualizarEstadoSincronizacion('loading', editId ? '● Guardando cambios…' : '● Agregando vehículo…');
      const guardado = editId
        ? await actualizarVehiculoRemoto(editId, nombre, precio)
        : await crearVehiculoRemoto(nombre, precio);

      if (editId) {
        const index = vehiculosCompartidos.findIndex(v => String(v.id) === String(editId));
        if (index >= 0) vehiculosCompartidos[index] = guardado;
      } else {
        vehiculosCompartidos.push(guardado);
      }
    } else if (editId) {
      const index = vehiculosCompartidos.findIndex(v => String(v.id) === String(editId));
      if (index === -1) throw new Error('No se encontró el vehículo para editar.');
      vehiculosCompartidos[index] = { ...vehiculosCompartidos[index], nombre, precio };
    } else {
      vehiculosCompartidos.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nombre, precio });
    }

    vehiculosCompartidos = ordenarVehiculos(vehiculosCompartidos);
    guardarVehiculosLocales(vehiculosCompartidos);

    if (vehiculoSeleccionado && String(vehiculoSeleccionado.id) === String(editId)) {
      vehiculoSeleccionado = { ...vehiculosCompartidos.find(v => String(v.id) === String(editId)) };
      actualizarVehiculoSeleccionadoUI();
    }

    resetFormularioVehiculo();
    renderListaVehiculos();
    renderResultadosVehiculos();
    actualizarEstadoSincronizacion(SUPABASE_ENABLED ? 'ok' : 'local', SUPABASE_ENABLED ? '● Sincronizado para todos los asesores' : '● Modo local');
    showToast(editId ? 'Vehículo actualizado' : 'Vehículo agregado');
  } catch (error) {
    actualizarEstadoSincronizacion('error', '● No se pudo guardar');
    console.warn('[Autosale] No se pudo guardar vehículo:', error.message);
    showToast('No se pudo guardar el vehículo');
  } finally {
    boton.disabled = false;
  }
}

/* ==========================================================================\n   4. BUSCADOR Y SELECCIÓN DE VEHÍCULOS\n   ========================================================================== */
function normalizarTexto(texto) {
  return String(texto || '')
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function renderResultadosVehiculos() {
  const input = document.getElementById('buscarVehiculo');
  const container = document.getElementById('resultadosVehiculos');
  if (!input || !container) return;

  // Si el usuario no tiene el cursor dentro del buscador, mantiene la lista oculta
  if (document.activeElement !== input) {
    container.classList.remove('vehicle-search__results--visible');
    return;
  }

  const query = normalizarTexto(input.value.trim());
  const vehiculos = obtenerVehiculos();

  if (!vehiculos.length) {
    container.innerHTML = query
      ? '<div class="vehicle-search__empty">No hay vehículos guardados todavía.</div>'
      : '';
    container.classList.toggle('vehicle-search__results--visible', Boolean(query));
    return;
  }

  if (!query) {
    container.innerHTML = '';
    container.classList.remove('vehicle-search__results--visible');
    return;
  }

  const resultados = vehiculos.filter(v => normalizarTexto(v.nombre).includes(query));

  if (!resultados.length) {
    container.innerHTML = '<div class="vehicle-search__empty">No se encontraron vehículos.</div>';
  } else {
    container.innerHTML = resultados.slice(0, 12).map(v => `
      <button type="button" class="vehicle-search__result" onclick="seleccionarVehiculo('${escapeJs(String(v.id))}')" role="option">
        <span class="vehicle-search__result-name">${escapeHtml(v.nombre)}</span>
        <span class="vehicle-search__result-price">${formatearPrecioUSD(v.precio)}</span>
      </button>
    `).join('');
  }

  container.classList.add('vehicle-search__results--visible');
}

function seleccionarVehiculo(id) {
  const vehiculo = obtenerVehiculos().find(v => String(v.id) === String(id));
  if (!vehiculo) return;

  vehiculoSeleccionado = { ...vehiculo };
  document.getElementById('precio').value = Number(vehiculo.precio);
  document.getElementById('buscarVehiculo').value = vehiculo.nombre;
  actualizarVehiculoSeleccionadoUI();
  ocultarResultadosVehiculos();

  const precio = Number(vehiculo.precio) || 0;
  if (pctInicialActivo !== null) {
    const inicial = Math.round(precio * (pctInicialActivo / 100));
    document.getElementById('inicial').value = inicial;
    document.getElementById('monto').value = Math.max(0, precio - inicial);
  } else {
    const inicial = parseFloat(document.getElementById('inicial').value) || 0;
    document.getElementById('monto').value = Math.max(0, precio - inicial);
  }

  calc();
}

function actualizarVehiculoSeleccionadoUI() {
  const box = document.getElementById('vehiculoSeleccionado');
  const nombre = document.getElementById('vehiculoSeleccionadoNombre');
  const clear = document.getElementById('limpiarVehiculo');
  if (!box || !nombre) return;

  if (vehiculoSeleccionado) {
    nombre.textContent = `${vehiculoSeleccionado.nombre} · ${formatearPrecioUSD(vehiculoSeleccionado.precio)}`;
    box.hidden = false;
    if (clear) clear.classList.add('vehicle-search__clear--visible');
  } else {
    nombre.textContent = '';
    box.hidden = true;
    if (clear) clear.classList.remove('vehicle-search__clear--visible');
  }
}

function ocultarResultadosVehiculos() {
  const container = document.getElementById('resultadosVehiculos');
  if (!container) return;
  container.classList.remove('vehicle-search__results--visible');
}

function limpiarVehiculoSeleccionado() {
  vehiculoSeleccionado = null;
  const input = document.getElementById('buscarVehiculo');
  if (input) input.value = '';
  actualizarVehiculoSeleccionadoUI();
  ocultarResultadosVehiculos();
}

/* ==========================================================================
   5. SELECCIÓN DE CHIPS
   ========================================================================== */
function selectPctInicial(pct) {
  pctInicialActivo = pct;
  const precio = parseFloat(document.getElementById('precio').value) || 0;
  const inicial = Math.round(precio * (pct / 100));

  document.getElementById('inicial').value = inicial;
  document.getElementById('monto').value = Math.max(0, precio - inicial);

  updatePctChips(pct);
  calc();
}

function updatePctChips(pct) {
  const container = document.getElementById('chips-pct-inicial');
  if (!container) return;
  container.querySelectorAll('.cotizador__chip').forEach(chip => {
    if (pct !== null && Math.abs(parseFloat(chip.getAttribute('data-pct')) - parseFloat(pct)) < 0.1) {
      chip.classList.add('cotizador__chip--active');
    } else {
      chip.classList.remove('cotizador__chip--active');
    }
  });
}

function selectChip(inputId, value) {
  document.getElementById(inputId).value = value;
  updateChips(inputId, value);
  calc();
}

function updateChips(inputId, value) {
  const container = document.getElementById(`chips-${inputId}`);
  if (!container) return;
  container.querySelectorAll('.cotizador__chip').forEach(chip => {
    if (parseFloat(chip.getAttribute('data-val')) === parseFloat(value)) {
      chip.classList.add('cotizador__chip--active');
    } else {
      chip.classList.remove('cotizador__chip--active');
    }
  });
}

/* ==========================================================================
   6. CÁLCULO FINANCIERO Y FORMATO
   ========================================================================== */
function formatBs(val) {
  return 'Bs ' + Math.round(val).toLocaleString('es-BO');
}

function calc() {
  const tc = parseFloat(document.getElementById('tc').value) || 0;
  const precio = parseFloat(document.getElementById('precio').value) || 0;
  const inicial = parseFloat(document.getElementById('inicial').value) || 0;
  const monto = parseFloat(document.getElementById('monto').value) || 0;

  document.getElementById('eq-precio').innerText = formatBs(precio * tc);
  document.getElementById('eq-inicial').innerText = formatBs(inicial * tc);
  document.getElementById('eq-monto').innerText = formatBs(monto * tc);

  const tasaInteres = parseFloat(document.getElementById('tasa').value) || 0;
  const yrs = parseFloat(document.getElementById('anios').value) || 0;

  if (monto <= 0 || tasaInteres <= 0 || yrs <= 0 || tc <= 0) {
    document.getElementById('resUSD').innerText = '$ 0';
    document.getElementById('resBOB').innerText = 'Bs 0';
    return;
  }

  // Amortización Francesa
  const montoBs = monto * tc;
  const tasaTotal = tasaInteres + SEGURO_DESGRAVAMEN;
  const n = yrs * 12;
  const i = (tasaTotal / 100) / 12;

  const cuotaBsCalculada = montoBs * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
  const cuotaBs = Math.round(cuotaBsCalculada);
  const cuotaUSD = Math.round(cuotaBsCalculada / tc);

  document.getElementById('resUSD').innerText = '$ ' + cuotaUSD.toLocaleString('en-US');
  document.getElementById('resBOB').innerText = 'Bs ' + cuotaBs.toLocaleString('es-BO');
}

/* ==========================================================================
   7. EVENT LISTENERS DE EDICIÓN SINCRONIZADA
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  document.getElementById('tc').addEventListener('input', calc);

  // Buscador de vehículos
  const buscarVehiculo = document.getElementById('buscarVehiculo');
  buscarVehiculo.addEventListener('input', renderResultadosVehiculos);
  buscarVehiculo.addEventListener('focus', () => {
    if (buscarVehiculo.value.trim()) renderResultadosVehiculos();
  });
  buscarVehiculo.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ocultarResultadosVehiculos();
  });

  // Al editar Precio manualmente: NO se elimina el vehículo seleccionado.
  // Esto permite modificar el precio de una cotización manteniendo el modelo en WhatsApp.
  document.getElementById('precio').addEventListener('input', (e) => {
    const precio = parseFloat(e.target.value) || 0;

    if (pctInicialActivo !== null) {
      const inicial = Math.round(precio * (pctInicialActivo / 100));
      document.getElementById('inicial').value = inicial;
      document.getElementById('monto').value = Math.max(0, precio - inicial);
    } else {
      const inicial = parseFloat(document.getElementById('inicial').value) || 0;
      document.getElementById('monto').value = Math.max(0, precio - inicial);
    }
    calc();
  });

  // Al editar Cuota Inicial
  document.getElementById('inicial').addEventListener('input', (e) => {
    const precio = parseFloat(document.getElementById('precio').value) || 0;
    let inicial = parseFloat(e.target.value) || 0;

    if (inicial > precio) {
      inicial = precio;
      e.target.value = inicial;
    }

    document.getElementById('monto').value = Math.max(0, precio - inicial);

    if (precio > 0) {
      pctInicialActivo = (inicial / precio) * 100;
      updatePctChips(pctInicialActivo);
    } else {
      pctInicialActivo = null;
      updatePctChips(null);
    }
    calc();
  });

  // Al editar Monto a Financiar
  document.getElementById('monto').addEventListener('input', (e) => {
    const precio = parseFloat(document.getElementById('precio').value) || 0;
    let monto = parseFloat(e.target.value) || 0;

    if (monto > precio) {
      monto = precio;
      e.target.value = monto;
    }

    const nuevaInicial = Math.max(0, precio - monto);
    document.getElementById('inicial').value = nuevaInicial;

    if (precio > 0) {
      pctInicialActivo = (nuevaInicial / precio) * 100;
      updatePctChips(pctInicialActivo);
    } else {
      pctInicialActivo = null;
      updatePctChips(null);
    }
    calc();
  });

  document.getElementById('tasa').addEventListener('input', (e) => {
    updateChips('tasa', e.target.value);
    calc();
  });

  document.getElementById('anios').addEventListener('input', (e) => {
    updateChips('anios', e.target.value);
    calc();
  });

  document.getElementById('vehiculoForm').addEventListener('submit', guardarVehiculoDesdeFormulario);

  document.addEventListener('click', (event) => {
    const search = document.querySelector('.vehicle-search');
    if (search && !search.contains(event.target)) ocultarResultadosVehiculos();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('vehiculosModal').hidden) {
      cerrarGestionVehiculos();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  calc();
  iniciarSincronizacionVehiculos();
});

/* ==========================================================================
   8. COMPARTIR / COPIAR EN WHATSAPP
   ========================================================================== */
async function copiar() {
  const tc = parseFloat(document.getElementById('tc').value) || 0;
  const precio = parseFloat(document.getElementById('precio').value) || 0;
  const inicial = parseFloat(document.getElementById('inicial').value) || 0;
  const monto = parseFloat(document.getElementById('monto').value) || 0;
  const tasa = document.getElementById('tasa').value;
  const anios = document.getElementById('anios').value;

  const resUSD = document.getElementById('resUSD').innerText;
  const resBOB = document.getElementById('resBOB').innerText;

  const precioBs = Math.round(precio * tc);
  const inicialBs = Math.round(inicial * tc);
  const montoBs = Math.round(monto * tc);

  let msg = `🚗 *AUTOSALE MOTORS - FINANCIAMIENTO BANCARIO*\n\n`;
  if (vehiculoSeleccionado?.nombre) {
    msg += `🚘 *Vehículo: ${vehiculoSeleccionado.nombre}*\n\n`;
  }
  msg += `• Tipo de Cambio: Bs ${tc}\n`;
  msg += `• Precio: $ ${precio.toLocaleString('en-US')} (${formatBs(precioBs)})\n`;
  msg += `• Cuota Inicial: $ ${inicial.toLocaleString('en-US')} (${formatBs(inicialBs)})\n`;
  msg += `• Monto a Financiar: $ ${monto.toLocaleString('en-US')} (${formatBs(montoBs)})\n`;
  msg += `• Tasa de Interés: ${tasa}%\n`;
  msg += `• Plazo: ${anios} años\n\n`;
  msg += `👉 *Cuota mensual: ${resUSD}* (${resBOB}/mes)`;

  if (navigator.share) {
    try {
      await navigator.share({ text: msg });
      return;
    } catch (err) {}
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(msg).then(() => showToast('¡Cotización copiada para WhatsApp!')).catch(() => fallbackCopy(msg));
  } else {
    fallbackCopy(msg);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
    showToast('¡Cotización copiada para WhatsApp!');
  } catch (err) {
    showToast('Error al copiar el texto');
  }
  document.body.removeChild(textArea);
}
