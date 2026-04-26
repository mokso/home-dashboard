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
});

// Show prompt if no password stored yet. API calls are deferred until submitted.
const _needsPassword = !getPassword();
if (_needsPassword) showPasswordPrompt();

const slotA = { slot: document.getElementById('slot-a'), bg: document.getElementById('bg-a'), fg: document.getElementById('fg-a'), caption: document.getElementById('caption-a') };
const slotB = { slot: document.getElementById('slot-b'), bg: document.getElementById('bg-b'), fg: document.getElementById('fg-b'), caption: document.getElementById('caption-b') };

let active = slotA;
let next = slotB;

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

// Daily reload at 04:00 — guards against multi-week JS-state drift.
(function scheduleDailyReload() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => location.reload(), next - now);
})();
