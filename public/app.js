const LOCALE = 'fi-FI';
const PHOTO_INTERVAL_MS = 5 * 60 * 1000;
const STATE_POLL_MS = 60 * 1000;
const RETRY_MS = 5000;

// Password ------------------------------------------------------------

const pwOverlay = document.getElementById('pw-overlay');
const pwForm = document.getElementById('pw-form');
const pwInput = document.getElementById('pw-input');
const PW_KEY = 'dashboard.password';

function getPassword() {
  return localStorage.getItem(PW_KEY) || '';
}

function apiFetch(url, opts = {}) {
  const pw = getPassword();
  const headers = { ...(opts.headers || {}) };
  if (pw) headers['X-Dashboard-Password'] = pw;
  return fetch(url, { ...opts, headers });
}

function showPasswordPrompt() {
  pwInput.value = '';
  pwOverlay.hidden = false;
  pwInput.focus();
}

function hidePasswordPrompt() {
  pwOverlay.hidden = true;
}

pwForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = pwInput.value.trim();
  if (!val) return;
  localStorage.setItem(PW_KEY, val);
  hidePasswordPrompt();
  pollState();
  triggerPhoto();
  loadCameraList();
  loadControls();
  pollMusic();
  loadPresets();
  loadVoice();
});

// Show prompt if no password stored yet. API calls are deferred until submitted.
const _needsPassword = !getPassword();
if (_needsPassword) showPasswordPrompt();

const slotA = { slot: document.getElementById('slot-a'), bg: document.getElementById('bg-a'), fg: document.getElementById('fg-a'), caption: document.getElementById('caption-a') };
const slotB = { slot: document.getElementById('slot-b'), bg: document.getElementById('bg-b'), fg: document.getElementById('fg-b'), caption: document.getElementById('caption-b') };

let active = slotA;
let next = slotB;

// Loads an API image into an <img>; with a password set the header has to
// go through fetch, so the image is set from a blob URL instead of src.
function setApiImage(img, url) {
  if (!getPassword()) { img.src = url; return; }
  apiFetch(url)
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (!blob) return;
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
    })
    .catch(() => {});
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Clock --------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const clockTimeEl = document.getElementById('clock-time');
const clockDateEl = document.getElementById('clock-date');

function tickClock() {
  const now = new Date();
  clockTimeEl.textContent = timeFmt.format(now);
  clockDateEl.textContent = dateFmt.format(now);
}
tickClock();
setInterval(tickClock, 1000);

// Weather ------------------------------------------------------------

const weatherEl = document.getElementById('weather');

function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '';
}

function fmtTemp(n) {
  return n == null ? '–' : `${Math.round(n)}°`;
}

function fmtPrecip(mm) {
  if (mm == null || mm <= 0) return '';
  return `<span class="weather-precip">💧 ${mm.toFixed(1)} mm</span>`;
}

const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const hourFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', hour12: false });

function dayLabel(dateStr, index) {
  if (index === 0) return 'Tänään';
  if (index === 1) return 'Huomenna';
  const d = new Date(`${dateStr}T00:00:00`);
  return isNaN(d.getTime()) ? '' : weekdayFmt.format(d);
}

function fmtHour(timeStr) {
  // Open-Meteo's hourly times are TZ-local without offset; parse as local.
  const stripped = String(timeStr).replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
  const d = new Date(stripped);
  return isNaN(d.getTime()) ? '' : hourFmt.format(d);
}

function renderWeather(w) {
  if (!w) { weatherEl.innerHTML = ''; return; }
  const now = w.now ?? {};
  const hourly = w.hourly ?? [];
  // Today is replaced by the hourly row, so daily starts at index 1.
  const days = (w.daily ?? []).slice(1, 3);

  const hourlyHtml = hourly.length ? `
    <div class="weather-hourly">
      ${hourly.map((h) => `
        <div class="weather-hour">
          <div class="hour-time">${escapeHtml(fmtHour(h.time))}</div>
          <div class="hour-icon">${weatherIcon(h.code)}</div>
          <div class="hour-temp">${fmtTemp(h.temp)}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const dayHtml = days.map((day, i) => `
    <div class="weather-day">
      <span class="weather-label">${escapeHtml(dayLabel(day.date, i + 1))}</span>
      <span class="weather-day-icon">${weatherIcon(day.code)}</span>
      <span class="weather-range">${fmtTemp(day.min)} / ${fmtTemp(day.max)}</span>
      ${fmtPrecip(day.precip)}
    </div>
  `).join('');

  weatherEl.innerHTML = `
    <div class="weather-current">
      <span class="weather-temp">${fmtTemp(now.temp)}</span>
      <span class="weather-icon">${weatherIcon(now.code)}</span>
    </div>
    ${hourlyHtml}
    ${dayHtml}
  `;
}

// Calendar -----------------------------------------------------------

const calendarEl = document.getElementById('calendar');
const calDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'numeric' });
const calTimeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

function parseEventStart(s, allDay) {
  if (!s) return null;
  // All-day events have plain "YYYY-MM-DD" — parse as local midnight.
  // Timed events carry an explicit offset like "+03:00", so Date parses fine.
  const d = allDay ? new Date(`${s}T00:00:00`) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function renderCalendar(events) {
  if (!events || !events.length) {
    calendarEl.innerHTML = '<div class="cal-empty">Ei tulevia tapahtumia</div>';
    return;
  }

  const groups = new Map();
  for (const e of events) {
    const start = parseEventStart(e.start, e.allDay);
    if (!start) continue;
    const key = localDayKey(start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ event: e, start });
  }

  const now = new Date();
  const todayKey = localDayKey(now);
  const tom = new Date(now);
  tom.setDate(tom.getDate() + 1);
  const tomKey = localDayKey(tom);

  const html = [...groups.keys()].sort().map((key) => {
    let label;
    if (key === todayKey) label = 'Tänään';
    else if (key === tomKey) label = 'Huomenna';
    else label = calDayFmt.format(new Date(`${key}T00:00:00`));

    const items = groups.get(key)
      .sort((a, b) => a.start - b.start)
      .map(({ event, start }) => {
        const time = event.allDay ? 'koko päivä' : calTimeFmt.format(start);
        return `
          <div class="cal-event">
            <span class="cal-time">${escapeHtml(time)}</span>
            <span class="cal-summary">${escapeHtml(event.summary || '')}</span>
          </div>
        `;
      }).join('');

    return `
      <div class="cal-day">
        <div class="cal-day-label">${escapeHtml(label)}</div>
        ${items}
      </div>
    `;
  }).join('');

  calendarEl.innerHTML = html;
}

// Sensors ------------------------------------------------------------

const sensorsEl = document.getElementById('sensors');
const SENSORS_EXPANDED_KEY = 'dashboard.sensors.expanded';

let lastSensorList = null;
let sensorHistoryCache = null;

const HISTORY_HOURS = 12;

const STATE_COLORS = {
  Charging: '#4caf50',
  Complete: '#42a5f5',
  WaitCar: '#ffc107',
  Idle:     '#444',
  Error:    '#ef5350',
};

function fmtDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtAxis(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function renderSparkline(points) {
  if (!points || points.length < 2) {
    return '<svg class="sensor-spark" viewBox="0 0 100 28"></svg>';
  }
  const vs = points.map((p) => p.value);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const range = vMax - vMin || 1;
  const W = 200;
  const H = 60;
  const pad = 3;
  const usable = H - pad * 2;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = pad + usable - ((p.value - vMin) / range) * usable;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => (pad + usable - f * usable).toFixed(1));
  const gridLines = gridYs.map((y) =>
    `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`
  ).join('');
  const gridXs = Array.from({ length: HISTORY_HOURS - 1 }, (_, i) => ((i + 1) * W / HISTORY_HOURS).toFixed(1));
  const gridCols = gridXs.map((x) =>
    `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`
  ).join('');
  return `<svg class="sensor-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${gridLines}
    ${gridCols}
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function renderSensors(list) {
  lastSensorList = list;
  if (!list || !list.length) {
    sensorsEl.innerHTML = '';
    return;
  }
  sensorsEl.innerHTML = list.map((s) => {
    if (s.text) {
      const hist = sensorHistoryCache?.find((h) => h.entity === s.entity);
      const segments = hist?.segments;
      let timeline = '';
      let axisX = '';
      if (segments && segments.length) {
        const segs = segments.map((seg) => {
          const dur = new Date(seg.to).getTime() - new Date(seg.from).getTime();
          const color = STATE_COLORS[seg.state] ?? '#444';
          const label = dur > 0 ? `<span class="timeline-seg-label">${escapeHtml(seg.state)}</span>` : '';
          return `<div class="timeline-seg" style="flex-grow:${dur};background:${color}" title="${escapeHtml(seg.state)} ${escapeHtml(fmtDuration(dur))}">${label}</div>`;
        }).join('');
        timeline = `<div class="sensor-timeline">${segs}</div>`;
        const fmtHr = (iso) => hourFmt.format(new Date(iso));
        axisX = `<div class="sensor-axis-x"><span>${escapeHtml(fmtHr(segments[0].from))}</span><span>nyt</span></div>`;
      }
      return `
        <div class="sensor-row sensor-row-text">
          <div class="sensor-header">
            <span class="sensor-label">${escapeHtml(s.label)}</span>
            <span class="sensor-value">${escapeHtml(String(s.value))}</span>
          </div>
          ${timeline}
          ${axisX}
        </div>
      `;
    }
    const hist = sensorHistoryCache?.find((h) => h.entity === s.entity);
    const points = hist?.points;
    let axisY = '';
    let axisX = '';
    if (points && points.length >= 2) {
      const vs = points.map((p) => p.value);
      const vMax = Math.max(...vs);
      const vMin = Math.min(...vs);
      axisY = `<div class="sensor-axis-y"><span>${escapeHtml(fmtAxis(vMax))}</span><span>${escapeHtml(fmtAxis(vMin))}</span></div>`;
      const tStart = points[0].t;
      const tMid = points[Math.floor((points.length - 1) / 2)].t;
      const fmtHr = (iso) => hourFmt.format(new Date(iso));
      axisX = `<div class="sensor-axis-x"><span>${escapeHtml(fmtHr(tStart))}</span><span>${escapeHtml(fmtHr(tMid))}</span><span>nyt</span></div>`;
    }
    return `
      <div class="sensor-row">
        <div class="sensor-header">
          <span class="sensor-label">${escapeHtml(s.label)}</span>
          <span class="sensor-value">${escapeHtml(String(s.value))} ${escapeHtml(s.unit || '')}</span>
        </div>
        <div class="sensor-chart">
          ${axisY}
          ${renderSparkline(points)}
        </div>
        ${axisX}
      </div>
    `;
  }).join('');
}

async function loadSensorHistory() {
  try {
    const res = await apiFetch('/api/sensors/history?hours=12', { cache: 'no-store' });
    if (res.status === 401) { localStorage.removeItem(PW_KEY); showPasswordPrompt(); return; }
    if (!res.ok) throw new Error(`status ${res.status}`);
    sensorHistoryCache = await res.json();
    if (lastSensorList) renderSensors(lastSensorList);
  } catch (err) {
    // silent — last-good values stay on screen
  }
}

function applySensorsExpanded(expanded) {
  sensorsEl.classList.toggle('expanded', expanded);
  document.body.classList.toggle('sensors-expanded', expanded);
  if (expanded && !sensorHistoryCache) loadSensorHistory();
  if (lastSensorList) renderSensors(lastSensorList);
}
applySensorsExpanded(localStorage.getItem(SENSORS_EXPANDED_KEY) === '1');

sensorsEl.addEventListener('click', () => {
  const next = !sensorsEl.classList.contains('expanded');
  applySensorsExpanded(next);
  localStorage.setItem(SENSORS_EXPANDED_KEY, next ? '1' : '0');
});

// Electricity --------------------------------------------------------

const electricityEl = document.getElementById('electricity');
const ELEC_COMPACT_KEY = 'dashboard.electricity.compact';

function applyElectricityCompact(compact) {
  electricityEl.classList.toggle('compact', compact);
  document.body.classList.toggle('electricity-compact', compact);
}
applyElectricityCompact(localStorage.getItem(ELEC_COMPACT_KEY) === '1');

electricityEl.addEventListener('click', () => {
  const next = !electricityEl.classList.contains('compact');
  applyElectricityCompact(next);
  localStorage.setItem(ELEC_COMPACT_KEY, next ? '1' : '0');
});

function fmtPrice(c) {
  if (c == null) return '–';
  return `${c.toFixed(1)} c/kWh`;
}

function renderElectricity(e) {
  if (!e || !e.hours || !e.hours.length) {
    electricityEl.innerHTML = '';
    return;
  }
  const prices = e.hours.map((h) => h.price);
  const min = Math.min(0, ...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const now = new Date();
  const HOUR_MS = 60 * 60 * 1000;

  const fmtBar = (p) => {
    const v = Math.round(p * 10) / 10;
    return v === 0 ? '0' : v.toFixed(1);
  };

  const bars = [];
  const labels = [];
  const hourLabels = [];
  for (const h of e.hours) {
    const start = new Date(h.t);
    const isCurrent = start <= now && now < new Date(start.getTime() + HOUR_MS);
    const klass = h.tier || 'mid';
    const norm = (h.price - min) / range;
    const heightPct = Math.max(6, Math.round(norm * 100));
    bars.push(
      `<div class="elec-bar ${klass}${isCurrent ? ' current' : ''}" style="height:${heightPct}%"></div>`,
    );
    labels.push(
      `<span class="elec-price${isCurrent ? ' current' : ''}"><span class="elec-price-num">${escapeHtml(fmtBar(h.price))}</span><span class="elec-unit">c/kWh</span></span>`,
    );
    hourLabels.push(
      `<span class="elec-hour${isCurrent ? ' current' : ''}">${escapeHtml(hourFmt.format(start))}</span>`,
    );
  }

  const nowTier = e.hours[0]?.tier || 'mid';
  electricityEl.innerHTML = `
    <div class="elec-header">
      <span class="elec-label">Sähkö</span>
      <span class="elec-now ${nowTier}">${escapeHtml(fmtPrice(e.now))}</span>
    </div>
    <div class="elec-bars">${bars.join('')}</div>
    <div class="elec-prices">${labels.join('')}</div>
    <div class="elec-hours">${hourLabels.join('')}</div>
  `;
}

// State poller -------------------------------------------------------

async function pollState() {
  try {
    const r = await apiFetch('/api/state', { cache: 'no-store' });
    if (r.status === 401) { localStorage.removeItem(PW_KEY); showPasswordPrompt(); return; }
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    if (data.title) document.title = data.title;
    if (data.weather) renderWeather(data.weather);
    if (data.calendar) renderCalendar(data.calendar);
    if (data.sensors !== undefined) renderSensors(data.sensors);
    if (data.electricity) renderElectricity(data.electricity);
  } catch (err) {
    // last-good values stay on screen
  }
}
if (!_needsPassword) pollState();
setInterval(pollState, STATE_POLL_MS);

// Photos -------------------------------------------------------------

function parseWallClock(iso) {
  // Immich's localDateTime is wall-clock time but stamped with a misleading "Z".
  // Strip any trailing offset so the browser parses it as local time.
  const stripped = String(iso).replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
  const d = new Date(stripped);
  return isNaN(d.getTime()) ? null : d;
}

function renderCaption(meta) {
  const segs = [];
  const d = meta.takenAt ? parseWallClock(meta.takenAt) : null;
  if (d) {
    const date = d.toLocaleDateString(LOCALE, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const time = d.toLocaleTimeString(LOCALE, {
      hour: '2-digit', minute: '2-digit',
    });
    segs.push(`${date} · ${time}`);
  }
  if (meta.place) segs.push(meta.place);
  return segs.join('  ·  ');
}

async function loadNext() {
  let meta;
  try {
    const res = await apiFetch('/api/photo/next', { cache: 'no-store' });
    if (res.status === 401) { localStorage.removeItem(PW_KEY); showPasswordPrompt(); return; }
    if (!res.ok) throw new Error(`status ${res.status}`);
    meta = await res.json();
  } catch (err) {
    setTimeout(loadNext, RETRY_MS);
    return;
  }

  const fg = next.fg;
  const bg = next.bg;
  const cap = next.caption;

  function applyImage(src) {
    fg.onload = () => {
      cap.textContent = renderCaption(meta);
      next.slot.classList.add('active');
      cap.classList.add('active');
      active.slot.classList.remove('active');
      active.caption.classList.remove('active');
      [active, next] = [next, active];
    };
    fg.onerror = () => setTimeout(loadNext, RETRY_MS);
    fg.src = src;
    bg.src = src;
  }

  const url = `/api/photo/asset/${encodeURIComponent(meta.id)}`;
  const pw = getPassword();
  if (pw) {
    apiFetch(url, { cache: 'no-store' }).then((r) => {
      if (r.status === 401) { localStorage.removeItem(PW_KEY); showPasswordPrompt(); return null; }
      if (!r.ok) { setTimeout(loadNext, RETRY_MS); return null; }
      return r.blob();
    }).then((blob) => {
      if (blob) applyImage(URL.createObjectURL(blob));
    }).catch(() => setTimeout(loadNext, RETRY_MS));
  } else {
    applyImage(url);
  }
}

// Photo cycle is driven by a self-rescheduling timeout (not setInterval) so
// manual refresh resets the next-fire moment cleanly.
let lastPhotoAt = Date.now();
let photoTimer = null;

function schedulePhoto() {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(triggerPhoto, PHOTO_INTERVAL_MS);
}

function triggerPhoto() {
  lastPhotoAt = Date.now();
  loadNext();
  schedulePhoto();
}

if (!_needsPassword) triggerPhoto();
if (!_needsPassword) loadCameraList();

// Manual refresh button + countdown ring ---------------------------

const refreshBtn = document.getElementById('refresh');
const refreshRing = document.querySelector('.refresh-ring-progress');
const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
refreshRing.style.strokeDasharray = String(RING_CIRCUMFERENCE);

function updateRefreshRing() {
  const elapsed = Date.now() - lastPhotoAt;
  const progress = Math.min(1, elapsed / PHOTO_INTERVAL_MS);
  refreshRing.style.strokeDashoffset = (progress * RING_CIRCUMFERENCE).toFixed(2);
}
updateRefreshRing();
setInterval(updateRefreshRing, 1000);

refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.remove('spinning');
  void refreshBtn.offsetWidth; // restart spin animation on rapid taps
  refreshBtn.classList.add('spinning');
  pollState();
  triggerPhoto();
});

// Cameras ------------------------------------------------------------

const camBtn = document.getElementById('cam-btn');
const camOverlay = document.getElementById('cam-overlay');
const camClose = document.getElementById('cam-close');
const camGrid = document.getElementById('cam-grid');

let camImgs = [];
let camPollTimer = null;
let focusedCamIndex = null;

function toggleCameraFocus(index) {
  focusedCamIndex = focusedCamIndex === index ? null : index;
  camGrid.classList.toggle('single', focusedCamIndex !== null);
  for (const { tile, index: i } of camImgs) {
    tile.classList.toggle('active', i === focusedCamIndex);
  }
}

async function loadCameraList() {
  try {
    const res = await apiFetch('/api/cameras');
    if (res.status === 401) { localStorage.removeItem(PW_KEY); showPasswordPrompt(); return; }
    if (!res.ok) return;
    const list = await res.json();
    if (!list.length) return;

    camImgs = [];
    camGrid.innerHTML = '';
    for (const cam of list) {
      const tile = document.createElement('div');
      tile.className = 'cam-tile';
      const img = document.createElement('img');
      img.alt = cam.label;
      const label = document.createElement('div');
      label.className = 'cam-tile-label';
      label.textContent = cam.label;
      tile.appendChild(img);
      tile.appendChild(label);
      tile.addEventListener('click', () => toggleCameraFocus(cam.index));
      camGrid.appendChild(tile);
      camImgs.push({ img, tile, index: cam.index });
    }
    camBtn.hidden = false;
  } catch (err) {
    // silent — no cameras configured
  }
}

function refreshCameraSnapshots() {
  const t = Date.now();
  const pw = getPassword();
  for (const { img, index } of camImgs) {
    if (pw) {
      apiFetch(`/api/cameras/${index}/snapshot?t=${t}`, { cache: 'no-store' })
        .then((r) => r.ok ? r.blob() : null)
        .then((blob) => { if (blob) img.src = URL.createObjectURL(blob); })
        .catch(() => {});
    } else {
      img.src = `/api/cameras/${index}/snapshot?t=${t}`;
    }
  }
}

function openCameras() {
  camOverlay.hidden = false;
  refreshCameraSnapshots();
  camPollTimer = setInterval(refreshCameraSnapshots, 1500);
}

function closeCameras() {
  camOverlay.hidden = true;
  clearInterval(camPollTimer);
  camPollTimer = null;
  focusedCamIndex = null;
  camGrid.classList.remove('single');
  for (const { tile } of camImgs) tile.classList.remove('active');
}

camBtn.addEventListener('click', openCameras);
camClose.addEventListener('click', closeCameras);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !camOverlay.hidden) closeCameras();
});

// Controls -----------------------------------------------------------

const ctrlBtn = document.getElementById('ctrl-btn');
const ctrlOverlay = document.getElementById('ctrl-overlay');
const ctrlClose = document.getElementById('ctrl-close');
const ctrlGrid = document.getElementById('ctrl-grid');

function ctrlStateText(state) {
  if (state === 'on') return 'Päällä';
  if (state === 'off') return 'Pois';
  return 'Ei saatavilla';
}

const CLIMATE_MODE_LABELS = { off: 'Pois', heat: 'Lämmitys', cool: 'Jäähdytys', auto: 'Auto' };
const CLIMATE_DEBOUNCE_MS = 800;

function fmtSetpoint(n) {
  if (n == null) return '–';
  return `${n.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`;
}

async function postControl(index, body) {
  const res = await apiFetch(`/api/controls/${index}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}

function renderToggleTile(ctrl) {
  const tile = document.createElement('button');
  tile.className = 'ctrl-tile';
  tile.innerHTML =
    `<span class="ctrl-tile-label">${escapeHtml(ctrl.label)}</span>` +
    `<span class="ctrl-tile-state"></span>`;
  const applyState = (state) => {
    tile.classList.toggle('on', state === 'on');
    tile.disabled = state !== 'on' && state !== 'off';
    tile.querySelector('.ctrl-tile-state').textContent = ctrlStateText(state);
    ctrl.state = state;
  };
  applyState(ctrl.state);
  tile.addEventListener('click', async () => {
    if (tile.classList.contains('pending')) return;
    tile.classList.add('pending');
    try {
      const dto = await postControl(ctrl.index, { on: ctrl.state !== 'on' });
      if (dto) applyState(dto.state);
    } catch (err) {
      // leave tile as-is; next open refreshes state
    } finally {
      tile.classList.remove('pending');
    }
  });
  return tile;
}

function renderClimateTile(ctrl) {
  const tile = document.createElement('div');
  tile.className = 'ctrl-tile ctrl-climate';
  if (ctrl.state === 'unavailable') {
    tile.classList.add('unavailable');
    tile.innerHTML =
      `<span class="ctrl-tile-label">${escapeHtml(ctrl.label)}</span>` +
      `<span class="ctrl-tile-state">${ctrlStateText(ctrl.state)}</span>`;
    return tile;
  }
  tile.innerHTML =
    `<div class="ctrl-climate-head">` +
      `<span class="ctrl-tile-label">${escapeHtml(ctrl.label)}</span>` +
      `<span class="ctrl-climate-current">Nyt ${fmtSetpoint(ctrl.current)}</span>` +
    `</div>` +
    `<div class="ctrl-climate-temp">` +
      `<button class="ctrl-climate-step" data-dir="-1" aria-label="Laske">−</button>` +
      `<span class="ctrl-climate-target"></span>` +
      `<button class="ctrl-climate-step" data-dir="1" aria-label="Nosta">+</button>` +
    `</div>` +
    `<div class="ctrl-climate-modes">` +
      ctrl.modes.map((m) =>
        `<button class="ctrl-climate-mode" data-mode="${m}">${CLIMATE_MODE_LABELS[m]}</button>`,
      ).join('') +
    `</div>`;

  const targetEl = tile.querySelector('.ctrl-climate-target');
  const apply = (dto) => {
    Object.assign(ctrl, dto);
    targetEl.textContent = fmtSetpoint(ctrl.target);
    tile.classList.toggle('off', ctrl.state === 'off');
    for (const b of tile.querySelectorAll('.ctrl-climate-mode')) {
      b.classList.toggle('active', b.dataset.mode === ctrl.state);
    }
  };
  apply(ctrl);

  // +/- taps adjust the target locally and send one request after a pause,
  // so tapping + three times sends a single set_temperature call.
  let debounce = null;
  for (const b of tile.querySelectorAll('.ctrl-climate-step')) {
    b.addEventListener('click', () => {
      if (ctrl.target == null) return;
      const next = ctrl.target + Number(b.dataset.dir) * ctrl.step;
      if (next < ctrl.min || next > ctrl.max) return;
      apply({ target: Math.round(next * 10) / 10 });
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        tile.classList.add('pending');
        try {
          await postControl(ctrl.index, { temperature: ctrl.target });
        } catch (err) {
          // next open refreshes state
        } finally {
          tile.classList.remove('pending');
        }
      }, CLIMATE_DEBOUNCE_MS);
    });
  }

  for (const b of tile.querySelectorAll('.ctrl-climate-mode')) {
    b.addEventListener('click', async () => {
      if (b.dataset.mode === ctrl.state || tile.classList.contains('pending')) return;
      const prev = ctrl.state;
      apply({ state: b.dataset.mode });
      tile.classList.add('pending');
      try {
        if (!(await postControl(ctrl.index, { hvac_mode: b.dataset.mode }))) apply({ state: prev });
      } catch (err) {
        apply({ state: prev });
      } finally {
        tile.classList.remove('pending');
      }
    });
  }
  return tile;
}

function renderControls(list) {
  ctrlGrid.innerHTML = '';
  for (const ctrl of list) {
    ctrlGrid.appendChild(ctrl.type === 'climate' ? renderClimateTile(ctrl) : renderToggleTile(ctrl));
  }
}

async function loadControls() {
  try {
    const res = await apiFetch('/api/controls', { cache: 'no-store' });
    if (res.status === 401) { localStorage.removeItem(PW_KEY); showPasswordPrompt(); return; }
    if (!res.ok) return;
    const list = await res.json();
    renderControls(list);
    if (list.length) ctrlBtn.hidden = false;
  } catch (err) {
    // silent — no controls configured
  }
}

function openControls() {
  ctrlOverlay.hidden = false;
  loadControls();
  loadPresets();
}

function closeControls() {
  ctrlOverlay.hidden = true;
}

ctrlBtn.addEventListener('click', openControls);
ctrlClose.addEventListener('click', closeControls);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ctrlOverlay.hidden) closeControls();
});

if (!_needsPassword) loadControls();

// Music --------------------------------------------------------------

const MUSIC_POLL_ACTIVE_MS = 5 * 1000;
const MUSIC_POLL_IDLE_MS = 30 * 1000;
const MUSIC_VOLUME_STEP = 0.05;
const MUSIC_DEBOUNCE_MS = 600;

const musicEl = document.getElementById('music');
const musicArt = document.getElementById('music-art');
const musicTitle = document.getElementById('music-title');
const musicArtist = document.getElementById('music-artist');
const musicVol = document.getElementById('music-vol');
const presetsTitle = document.getElementById('music-presets-title');
const presetsGrid = document.getElementById('music-presets');

let music = null;
let musicArtKey = null;
let musicPollTimer = null;
let musicVolDebounce = null;

function isMusicActive(m) {
  return m && (m.state === 'playing' || m.state === 'paused');
}

function renderMusic(m) {
  music = m;
  musicEl.hidden = !isMusicActive(m);
  if (musicEl.hidden) return;
  musicEl.classList.toggle('playing', m.state === 'playing');
  musicTitle.textContent = m.title ?? '';
  musicArtist.textContent = m.artist ?? '';
  musicVol.textContent = m.volume == null ? '' : `${Math.round(m.volume * 100)}%`;
  if (m.artKey !== musicArtKey) {
    musicArtKey = m.artKey;
    musicArt.hidden = !m.artKey;
    if (m.artKey) setApiImage(musicArt, `/api/music/art?k=${m.artKey}`);
  }
}

async function pollMusic() {
  clearTimeout(musicPollTimer);
  try {
    const res = await apiFetch('/api/music', { cache: 'no-store' });
    if (res.status === 404) return; // no player configured — stop polling
    if (res.ok) renderMusic(await res.json());
  } catch (err) {
    // keep last render; retry on next tick
  }
  musicPollTimer = setTimeout(pollMusic, isMusicActive(music) ? MUSIC_POLL_ACTIVE_MS : MUSIC_POLL_IDLE_MS);
}

async function postMusic(url, body) {
  musicEl.classList.add('pending');
  try {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) renderMusic(await res.json());
    return res.ok;
  } catch (err) {
    return false;
  } finally {
    musicEl.classList.remove('pending');
  }
}

for (const b of musicEl.querySelectorAll('[data-action]')) {
  b.addEventListener('click', () => postMusic('/api/music/command', { action: b.dataset.action }));
}

// Volume +/- adjusts locally and sends one request after a pause.
for (const b of musicEl.querySelectorAll('[data-vol]')) {
  b.addEventListener('click', () => {
    if (music?.volume == null) return;
    const next = Math.min(1, Math.max(0, music.volume + Number(b.dataset.vol) * MUSIC_VOLUME_STEP));
    renderMusic({ ...music, volume: Math.round(next * 100) / 100 });
    clearTimeout(musicVolDebounce);
    musicVolDebounce = setTimeout(
      () => postMusic('/api/music/command', { action: 'volume', value: music.volume }),
      MUSIC_DEBOUNCE_MS,
    );
  });
}

function renderPresets(list) {
  presetsGrid.innerHTML = '';
  presetsTitle.hidden = !list.length;
  for (const p of list) {
    const tile = document.createElement('button');
    tile.className = 'music-preset';
    tile.innerHTML = `<span class="music-preset-name">${escapeHtml(p.name)}</span>`;
    if (p.hasImage) {
      const img = document.createElement('img');
      img.alt = '';
      tile.prepend(img);
      setApiImage(img, `/api/music/presets/${p.index}/image?u=${encodeURIComponent(p.uri)}`);
    }
    tile.addEventListener('click', async () => {
      if (tile.classList.contains('pending')) return;
      tile.classList.add('pending');
      const ok = await postMusic('/api/music/play', { uri: p.uri });
      tile.classList.remove('pending');
      if (ok) {
        closeControls();
        pollMusic();
      }
    });
    presetsGrid.appendChild(tile);
  }
}

async function loadPresets() {
  try {
    const res = await apiFetch('/api/music/presets', { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    renderPresets(list);
    if (list.length) ctrlBtn.hidden = false;
  } catch (err) {
    // silent — no music configured
  }
}

if (!_needsPassword) {
  pollMusic();
  loadPresets();
}

// Voice assistant ---------------------------------------------------
// Tap to talk: records 16 kHz mono audio until a pause in speech, then the
// backend runs it through HA speech-to-text, the conversation agent and TTS.

const VOICE_SAMPLE_RATE = 16000;
const VOICE_SPEECH_RMS = 0.02;       // level counted as speech
const VOICE_END_SILENCE_MS = 1200;   // pause that ends the recording
const VOICE_NO_SPEECH_MS = 6000;     // give up if nothing is said
const VOICE_MAX_MS = 12000;
const VOICE_BUBBLE_MS = 8000;

const voiceBtn = document.getElementById('voice-btn');
const voiceBubble = document.getElementById('voice-bubble');
const voiceHeard = document.getElementById('voice-heard');
const voiceAnswer = document.getElementById('voice-answer');

const VOICE_WORKLET = `
class Recorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('recorder', Recorder);`;

let voiceRec = null;       // active recording session
let voiceBusy = false;     // waiting for HA
let voiceHideTimer = null;
let voiceAudio = null;

function showVoiceBubble(heard, answer, hideAfterMs) {
  clearTimeout(voiceHideTimer);
  voiceHeard.textContent = heard;
  voiceAnswer.textContent = answer;
  voiceBubble.hidden = false;
  if (hideAfterMs) voiceHideTimer = setTimeout(hideVoiceBubble, hideAfterMs);
}

function hideVoiceBubble() {
  clearTimeout(voiceHideTimer);
  voiceBubble.hidden = true;
}

function encodeWav(chunks) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, VOICE_SAMPLE_RATE, true); v.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, length * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function startVoice() {
  if (voiceAudio) { voiceAudio.pause(); voiceAudio = null; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    showVoiceBubble('', 'Mikrofoni ei ole käytettävissä.', VOICE_BUBBLE_MS);
    return;
  }
  const ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  const moduleUrl = URL.createObjectURL(new Blob([VOICE_WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'recorder');
  source.connect(node);
  node.connect(ctx.destination); // keeps the node pulled; it outputs silence

  const startedAt = Date.now();
  const rec = { stream, ctx, chunks: [], heardSpeech: false, lastSpeechAt: 0 };
  voiceRec = rec;
  node.port.onmessage = (e) => {
    const samples = e.data;
    rec.chunks.push(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const now = Date.now();
    if (Math.sqrt(sum / samples.length) > VOICE_SPEECH_RMS) {
      rec.heardSpeech = true;
      rec.lastSpeechAt = now;
    }
    if (rec.heardSpeech && now - rec.lastSpeechAt > VOICE_END_SILENCE_MS) stopVoice(true);
    else if (!rec.heardSpeech && now - startedAt > VOICE_NO_SPEECH_MS) stopVoice(false);
    else if (now - startedAt > VOICE_MAX_MS) stopVoice(true);
  };

  voiceBtn.classList.add('listening');
  showVoiceBubble('', 'Kuuntelen…');
}

async function stopVoice(send) {
  const rec = voiceRec;
  if (!rec) return;
  voiceRec = null;
  rec.stream.getTracks().forEach((t) => t.stop());
  rec.ctx.close();
  voiceBtn.classList.remove('listening');
  if (!send || !rec.heardSpeech) {
    showVoiceBubble('', 'En kuullut mitään.', 3000);
    return;
  }

  voiceBusy = true;
  voiceBtn.classList.add('thinking');
  showVoiceBubble('', 'Hetkinen…');
  try {
    const res = await apiFetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: encodeWav(rec.chunks),
    });
    if (!res.ok) throw new Error(`voice ${res.status}`);
    const r = await res.json();
    if (!r.text) {
      showVoiceBubble('', 'En saanut selvää.', 4000);
      return;
    }
    showVoiceBubble(`”${r.text}”`, r.response || '…', VOICE_BUBBLE_MS);
    if (r.ttsId) playVoiceReply(r.ttsId);
    // A command may have changed something shown on the dashboard.
    setTimeout(() => { pollState(); pollMusic(); }, 1500);
  } catch (err) {
    showVoiceBubble('', 'Puheavustaja ei vastannut.', VOICE_BUBBLE_MS);
  } finally {
    voiceBusy = false;
    voiceBtn.classList.remove('thinking');
  }
}

async function playVoiceReply(id) {
  try {
    const res = await apiFetch(`/api/voice/tts/${id}`);
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    voiceAudio = new Audio(url);
    // Keep the answer on screen until the reply has been spoken.
    clearTimeout(voiceHideTimer);
    voiceAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      voiceHideTimer = setTimeout(hideVoiceBubble, 4000);
    });
    await voiceAudio.play();
  } catch (err) {
    voiceHideTimer = setTimeout(hideVoiceBubble, VOICE_BUBBLE_MS);
  }
}

async function loadVoice() {
  // Microphone access needs HTTPS (or localhost).
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const res = await apiFetch('/api/voice');
    if (res.ok) voiceBtn.hidden = false;
  } catch (err) {
    // silent — voice not configured
  }
}

voiceBtn.addEventListener('click', () => {
  if (voiceBusy) return;
  if (voiceRec) stopVoice(true);
  else startVoice();
});
voiceBubble.addEventListener('click', hideVoiceBubble);

if (!_needsPassword) loadVoice();

// Daily reload at 04:00 — guards against multi-week JS-state drift.
(function scheduleDailyReload() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => location.reload(), next - now);
})();
