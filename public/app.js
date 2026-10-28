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
  loadVoice();
  loadRadar();
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

// Local-midnight dates an all-day event covers, clipped to [today, lastDay].
// The end date from HA is exclusive: an event ending "2026-10-01" lasts
// through 30.9.
function allDayEventDays(e, start, today, lastDay) {
  const end = parseEventStart(e.end, true);
  const days = [];
  const d = new Date(Math.max(start, today));
  while (d <= lastDay && (end ? d < end : days.length === 0)) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function renderCalendar(events, daysAhead = 5) {
  if (!events || !events.length) {
    calendarEl.innerHTML = '<div class="cal-empty">Ei tulevia tapahtumia</div>';
    return;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastDay = new Date(today);
  lastDay.setDate(lastDay.getDate() + daysAhead);

  const groups = new Map();
  const addToDay = (day, entry) => {
    const key = localDayKey(day);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  };
  for (const e of events) {
    const start = parseEventStart(e.start, e.allDay);
    if (!start) continue;
    if (e.allDay) {
      // Multi-day all-day events appear on every day they cover.
      for (const day of allDayEventDays(e, start, today, lastDay)) addToDay(day, { event: e, start: day });
    } else {
      addToDay(start, { event: e, start });
    }
  }

  if (!groups.size) {
    calendarEl.innerHTML = '<div class="cal-empty">Ei tulevia tapahtumia</div>';
    return;
  }

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
    if (data.calendar) renderCalendar(data.calendar, data.calendarDays);
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

// Narrow screens (UVP desk phone) hide photos, cameras and music; skip their downloads too.
const narrowScreen = matchMedia('(max-width: 700px)').matches;

function triggerPhoto() {
  if (narrowScreen) return;
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

async function loadCameraList(force) {
  if (narrowScreen && !force) return;
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
    if (focusedCamIndex !== null && index !== focusedCamIndex) continue; // hidden tile
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
  clearTimeout(doorbellCloseTimer);
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

// Doorbell -----------------------------------------------------------
// A press opens the doorbell camera fullscreen for a while, also on the UVP where cameras are hidden.

const DOORBELL_POLL_MS = 2000;
const DOORBELL_SHOW_MS = 20 * 1000;
let doorbellSeen = null; // { state, lastChanged } from the previous poll
let doorbellCloseTimer = null;

async function pollDoorbell() {
  try {
    const res = await apiFetch('/api/doorbell');
    if (res.status === 404) return; // not configured: stop polling
    if (res.ok) {
      const d = await res.json();
      // A short press can start and end between polls, so off -> off with a new timestamp counts too.
      const pressed = doorbellSeen && d.lastChanged !== doorbellSeen.lastChanged
        && (d.state === 'on' || (d.state === 'off' && doorbellSeen.state === 'off'));
      doorbellSeen = d;
      if (pressed) showDoorbell(d.camera);
    }
  } catch (err) {
    // keep polling
  }
  setTimeout(pollDoorbell, DOORBELL_POLL_MS);
}

async function showDoorbell(cameraIndex) {
  if (window.fully) fully.turnScreenOn(); // Fully Kiosk's JavaScript interface, when enabled
  if (!camImgs.length) await loadCameraList(true);
  if (!camImgs.length) return;
  if (camOverlay.hidden) openCameras();
  if (cameraIndex >= 0 && focusedCamIndex !== cameraIndex) toggleCameraFocus(cameraIndex);
  refreshCameraSnapshots();
  clearTimeout(doorbellCloseTimer);
  doorbellCloseTimer = setTimeout(closeCameras, DOORBELL_SHOW_MS);
}

if (!_needsPassword) pollDoorbell();

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

// Texts for CONTROL_N_STATUS_ENTITY values (Azure VM power states).
const CTRL_STATUS_TEXT = {
  starting: 'Käynnistyy…',
  running: 'Käynnissä',
  stopping: 'Sammuu…',
  deallocating: 'Sammuu…',
  restarting: 'Käynnistyy uudelleen…',
  stopped: 'Sammutettu',
  deallocated: 'Sammutettu',
};
const CTRL_TRANSITIONAL = ['starting', 'stopping', 'deallocating', 'restarting'];
const CTRL_POLL_MS = 5 * 1000;

let ctrlPollTimer = null;
const ctrlToggleUpdaters = new Map(); // control index -> apply(dto)

function toggleStateText(dto) {
  const statusText = CTRL_STATUS_TEXT[dto.status];
  if (dto.busy) {
    if (CTRL_TRANSITIONAL.includes(dto.status)) return statusText;
    return dto.pendingTarget === 'off' ? 'Sammuu…' : 'Käynnistyy…';
  }
  return statusText || ctrlStateText(dto.state);
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
  // 409 = control is busy; the body is its current state.
  return res.ok || res.status === 409 ? res.json() : null;
}

function renderToggleTile(ctrl) {
  const tile = document.createElement('button');
  tile.className = 'ctrl-tile';
  tile.innerHTML =
    `<span class="ctrl-tile-label">${escapeHtml(ctrl.label)}</span>` +
    `<span class="ctrl-tile-state"></span>`;
  // Busy = waiting for the entity to reach the requested state (the backend
  // blocks further taps meanwhile), shown with a pulsing tile.
  const apply = (dto) => {
    Object.assign(ctrl, dto);
    if (!dto.busy) delete ctrl.pendingTarget;
    tile.classList.toggle('on', ctrl.state === 'on');
    tile.classList.toggle('busy', !!ctrl.busy);
    tile.disabled = !!ctrl.busy || (ctrl.state !== 'on' && ctrl.state !== 'off');
    tile.querySelector('.ctrl-tile-state').textContent = toggleStateText(ctrl);
  };
  apply(ctrl);
  ctrlToggleUpdaters.set(ctrl.index, apply);
  tile.addEventListener('click', async () => {
    if (ctrl.busy) return;
    const target = ctrl.state === 'on' ? 'off' : 'on';
    apply({ busy: true, pendingTarget: target });
    try {
      const dto = await postControl(ctrl.index, { on: target === 'on' });
      apply(dto ?? { busy: false });
    } catch (err) {
      apply({ busy: false });
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
  ctrlToggleUpdaters.clear();
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

// While the overlay is open, toggle tiles refresh in place so slow switches
// show their progress. Climate tiles are left alone so a refresh can't
// overwrite a target temperature that is still being adjusted.
async function refreshToggleTiles() {
  try {
    const res = await apiFetch('/api/controls', { cache: 'no-store' });
    if (!res.ok) return;
    for (const dto of await res.json()) {
      if (dto.type === 'toggle') ctrlToggleUpdaters.get(dto.index)?.(dto);
    }
  } catch (err) {
    // keep current tiles; next tick retries
  }
}

function openControls() {
  ctrlOverlay.hidden = false;
  loadControls();
  clearInterval(ctrlPollTimer);
  ctrlPollTimer = setInterval(refreshToggleTiles, CTRL_POLL_MS);
}

function closeControls() {
  ctrlOverlay.hidden = true;
  clearInterval(ctrlPollTimer);
  ctrlPollTimer = null;
}

ctrlBtn.addEventListener('click', openControls);
ctrlClose.addEventListener('click', closeControls);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ctrlOverlay.hidden) closeControls();
});

if (!_needsPassword) loadControls();

// Music --------------------------------------------------------------
// A music button in the fab row (animated while playing) opens a fullscreen
// view: now playing on the left, library browser on the right.

const MUSIC_POLL_ACTIVE_MS = 5 * 1000;
const MUSIC_POLL_IDLE_MS = 30 * 1000;
const MUSIC_POLL_OPEN_MS = 3 * 1000;
const MUSIC_VOLUME_STEP = 0.05;
const MUSIC_DEBOUNCE_MS = 600;
const MUSIC_VIEW_IDLE_MS = 3 * 60 * 1000;
const MUSIC_REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const MUSIC_TYPE_LABELS = { playlist: 'Soittolista', album: 'Albumi', artist: 'Artisti', track: 'Kappale', radio: 'Radio' };

const musicBtn = document.getElementById('music-btn');
const musicOverlay = document.getElementById('music-overlay');
const musicClose = document.getElementById('music-close');
const mvNow = document.getElementById('mv-now');
const mvArt = document.getElementById('mv-art');
const mvTitle = document.getElementById('mv-title');
const mvArtist = document.getElementById('mv-artist');
const mvProgress = document.getElementById('mv-progress');
const mvProgressFill = document.getElementById('mv-progress-fill');
const mvElapsed = document.getElementById('mv-elapsed');
const mvDuration = document.getElementById('mv-duration');
const mvShuffle = document.getElementById('mv-shuffle');
const mvRepeat = document.getElementById('mv-repeat');
const mvNext = document.getElementById('mv-next');
const mvSpeakers = document.getElementById('mv-speakers');
const mvTabs = document.getElementById('mv-tabs');
const mvGrid = document.getElementById('mv-grid');
const musicVol = document.getElementById('music-vol');
const musicBadge = document.getElementById('music-badge');
const musicBadgeText = document.getElementById('music-badge-text');
const MUSIC_BADGE_SCROLL_PX_S = 40;

let music = null;
let musicReceivedAt = 0;
let musicArtKey = null;
let musicSpeakersKey = null;
let musicPollTimer = null;
let musicVolDebounce = null;
let musicTickTimer = null;
let musicIdleTimer = null;
let musicLibrary = [];
let musicLibraryKey = null;
let musicTab = null;
let musicBadgeKey = null;

function isMusicActive(m) {
  return m && (m.state === 'playing' || m.state === 'paused');
}

function formatTrackTime(s) {
  if (s == null || !Number.isFinite(s)) return '';
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function musicElapsed() {
  if (!music || music.elapsed == null) return null;
  let e = music.elapsed;
  if (music.state === 'playing') e += (Date.now() - musicReceivedAt) / 1000;
  return music.duration ? Math.min(e, music.duration) : e;
}

function renderProgress() {
  const elapsed = musicElapsed();
  const duration = isMusicActive(music) ? music.duration : null;
  mvProgress.classList.toggle('disabled', !duration);
  mvProgressFill.style.transform = `scaleX(${duration && elapsed != null ? elapsed / duration : 0})`;
  mvElapsed.textContent = duration ? formatTrackTime(elapsed) : '';
  mvDuration.textContent = duration ? formatTrackTime(duration) : '';
}

function renderSpeakers(list) {
  const key = JSON.stringify(list);
  if (key === musicSpeakersKey) return;
  musicSpeakersKey = key;
  mvSpeakers.innerHTML = '';
  mvSpeakers.hidden = list.length < 2;
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'mv-speaker' + (s.active ? ' active' : '');
    b.textContent = s.name;
    b.addEventListener('click', () => {
      if (!s.active) postMusic('/api/music/speaker', { index: s.index });
    });
    mvSpeakers.appendChild(b);
  }
}

function renderNowPlaying() {
  const m = music;
  const active = isMusicActive(m);
  musicOverlay.classList.toggle('playing', m.state === 'playing');
  mvTitle.textContent = active ? (m.title ?? '') : 'Ei toistoa';
  mvArtist.textContent = active ? [m.artist, m.album].filter(Boolean).join(' · ') : 'Valitse soitettavaa';
  mvShuffle.classList.toggle('active', !!m.shuffle);
  mvRepeat.classList.toggle('active', m.repeat === 'all' || m.repeat === 'one');
  mvRepeat.classList.toggle('one', m.repeat === 'one');
  musicVol.textContent = m.volume == null ? '' : `${Math.round(m.volume * 100)}%`;
  mvNext.textContent = m.next ? `Seuraavaksi: ${[m.next.title, m.next.artist].filter(Boolean).join(' – ')}` : '';
  const artKey = active ? m.artKey : null;
  if (artKey !== musicArtKey) {
    musicArtKey = artKey;
    mvArt.hidden = !artKey;
    if (artKey) setApiImage(mvArt, `/api/music/art?k=${artKey}`);
  }
  renderSpeakers(m.speakers ?? []);
  renderProgress();
}

// Text that doesn't fit scrolls right to left as a seamless loop (two
// copies side by side). Measured only when the text changes, and only while
// visible, since a hidden badge has no width.
function renderMusicBadge(text, show) {
  musicBadge.hidden = !show;
  if (!show || text === musicBadgeKey) return;
  musicBadgeKey = text;
  musicBadgeText.classList.remove('scrolling');
  musicBadgeText.innerHTML = `<span class="music-badge-track"><span>${escapeHtml(text)}</span></span>`;
  if (musicBadgeText.scrollWidth <= musicBadgeText.clientWidth) return;
  const track = musicBadgeText.firstElementChild;
  track.insertAdjacentHTML('beforeend', `<span aria-hidden="true">${escapeHtml(text)}</span>`);
  musicBadgeText.classList.add('scrolling');
  const shift = track.firstElementChild.offsetWidth;
  track.style.setProperty('--badge-shift', `-${shift}px`);
  track.style.setProperty('--badge-duration', `${shift / MUSIC_BADGE_SCROLL_PX_S}s`);
}

function renderMusic(m) {
  // Keep the locally adjusted volume while a volume change is still pending.
  if (musicVolDebounce && music) m = { ...m, volume: music.volume };
  music = m;
  musicReceivedAt = Date.now();
  musicBtn.hidden = false;
  musicBtn.classList.toggle('playing', m.state === 'playing');
  // Slim "artist – song" badge under the buttons while something plays.
  const badgeText = [m.artist, m.title].filter((s) => s && s !== '[unknown]').join(' – ');
  renderMusicBadge(badgeText, m.state === 'playing' && !!badgeText);
  if (!musicOverlay.hidden) renderNowPlaying();
}

async function pollMusic() {
  if (narrowScreen) return;
  clearTimeout(musicPollTimer);
  try {
    const res = await apiFetch('/api/music', { cache: 'no-store' });
    if (res.status === 404) return; // no player configured — stop polling
    if (res.ok) renderMusic(await res.json());
  } catch (err) {
    // keep last render; retry on next tick
  }
  const delay = !musicOverlay.hidden ? MUSIC_POLL_OPEN_MS : isMusicActive(music) ? MUSIC_POLL_ACTIVE_MS : MUSIC_POLL_IDLE_MS;
  musicPollTimer = setTimeout(pollMusic, delay);
}

async function postMusic(url, body) {
  mvNow.classList.add('pending');
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
    mvNow.classList.remove('pending');
  }
}

for (const b of mvNow.querySelectorAll('[data-action]')) {
  b.addEventListener('click', () => postMusic('/api/music/command', { action: b.dataset.action }));
}

mvShuffle.addEventListener('click', () => {
  if (music) postMusic('/api/music/command', { action: 'shuffle', value: !music.shuffle });
});

mvRepeat.addEventListener('click', () => {
  if (music) postMusic('/api/music/command', { action: 'repeat', value: MUSIC_REPEAT_NEXT[music.repeat] ?? 'all' });
});

// Tap anywhere on the progress bar to jump there.
mvProgress.addEventListener('click', (e) => {
  if (!music?.duration || !isMusicActive(music)) return;
  const rect = mvProgress.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const position = frac * music.duration;
  music = { ...music, elapsed: position };
  musicReceivedAt = Date.now();
  renderProgress();
  postMusic('/api/music/command', { action: 'seek', value: position });
});

// Volume +/- adjusts locally and sends one request after a pause.
for (const b of mvNow.querySelectorAll('[data-vol]')) {
  b.addEventListener('click', () => {
    if (music?.volume == null) return;
    const next = Math.min(1, Math.max(0, music.volume + Number(b.dataset.vol) * MUSIC_VOLUME_STEP));
    music = { ...music, volume: Math.round(next * 100) / 100 };
    renderNowPlaying();
    clearTimeout(musicVolDebounce);
    musicVolDebounce = setTimeout(() => {
      musicVolDebounce = null;
      postMusic('/api/music/command', { action: 'volume', value: music.volume });
    }, MUSIC_DEBOUNCE_MS);
  });
}

// Library browser ----------------------------------------------------

// Tile images load only once scrolled near view; the library has hundreds.
const mvImageObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    mvImageObserver.unobserve(e.target);
    setApiImage(e.target, e.target.dataset.src);
  }
}, { root: mvGrid, rootMargin: '300px' });

function musicTile(item) {
  // Recently played mixes types, so its tiles say what each one is.
  const subtitle = item.group === 'recent'
    ? [MUSIC_TYPE_LABELS[item.mediaType], item.subtitle].filter(Boolean).join(' · ')
    : item.subtitle;
  const tile = document.createElement('button');
  tile.className = 'music-preset';
  tile.innerHTML = `<span class="music-preset-name">${escapeHtml(item.name)}${
    subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''
  }</span>`;
  if (item.hasImage) {
    const img = document.createElement('img');
    img.alt = '';
    img.dataset.src = `/api/music/library/${item.index}/image?u=${encodeURIComponent(item.uri)}`;
    tile.prepend(img);
    mvImageObserver.observe(img);
  }
  tile.addEventListener('click', async () => {
    if (tile.classList.contains('pending')) return;
    tile.classList.add('pending');
    await postMusic('/api/music/play', { uri: item.uri });
    tile.classList.remove('pending');
  });
  return tile;
}

function clearMusicGrid() {
  mvImageObserver.disconnect();
  for (const img of mvGrid.querySelectorAll('img')) {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  }
  mvGrid.innerHTML = '';
}

function renderMusicGrid() {
  clearMusicGrid();
  for (const t of mvTabs.children) t.classList.toggle('active', t.dataset.group === musicTab);
  const items = musicLibrary.filter((i) => i.group === musicTab);
  if (items.length) {
    const grid = document.createElement('div');
    grid.className = 'mv-tiles';
    for (const item of items) grid.appendChild(musicTile(item));
    mvGrid.appendChild(grid);
  } else {
    mvGrid.innerHTML = '<div class="mv-empty">Ei kohteita</div>';
  }
  mvGrid.scrollTop = 0;
}

async function loadMusicLibrary() {
  try {
    const res = await apiFetch('/api/music/library', { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    if (text === musicLibraryKey) return; // unchanged — keep tiles and images
    musicLibraryKey = text;
    musicLibrary = JSON.parse(text);
    const groups = new Set(musicLibrary.map((i) => i.group));
    for (const t of mvTabs.children) t.hidden = !groups.has(t.dataset.group);
    if (!groups.has(musicTab)) musicTab = [...mvTabs.children].find((t) => !t.hidden)?.dataset.group ?? null;
    renderMusicGrid();
  } catch (err) {
    // keep current grid
  }
}

for (const t of mvTabs.children) {
  t.addEventListener('click', () => {
    if (t.dataset.group === musicTab) return;
    musicTab = t.dataset.group;
    renderMusicGrid();
  });
}

// Music view ---------------------------------------------------------

// Closes by itself after a while so a forgotten view doesn't hide the photos.
function resetMusicIdle() {
  clearTimeout(musicIdleTimer);
  musicIdleTimer = setTimeout(closeMusic, MUSIC_VIEW_IDLE_MS);
}

function openMusic() {
  musicOverlay.hidden = false;
  if (music) renderNowPlaying();
  loadMusicLibrary();
  pollMusic();
  clearInterval(musicTickTimer);
  musicTickTimer = setInterval(renderProgress, 1000);
  resetMusicIdle();
}

function closeMusic() {
  musicOverlay.hidden = true;
  clearInterval(musicTickTimer);
  clearTimeout(musicIdleTimer);
  pollMusic();
}

musicBtn.addEventListener('click', openMusic);
musicBadge.addEventListener('click', openMusic);
musicClose.addEventListener('click', closeMusic);
musicOverlay.addEventListener('pointerdown', resetMusicIdle);
mvGrid.addEventListener('scroll', resetMusicIdle, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !musicOverlay.hidden) closeMusic();
});

if (!_needsPassword) pollMusic();

// Voice assistant ---------------------------------------------------
// Tap to talk: records 16 kHz mono audio until a pause in speech, then the
// backend runs it through HA speech-to-text, the conversation agent and TTS.

const VOICE_SAMPLE_RATE = 16000;
const VOICE_SPEECH_RMS = narrowScreen ? 0.004 : 0.02; // lowest level counted as speech; the UVP mic can peak at only 0.005–0.01
const VOICE_SPEECH_RMS_MAX = 0.05;   // cap, in case someone talks during noise calibration
const VOICE_NOISE_MS = 300;          // room noise is measured this long after the tap
const VOICE_NOISE_FACTOR = 4;        // speech must be this many times louder than the room
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
let voiceLevel = 0;
let voicePlayCtx = null;   // reused for every reply, so it stays unlocked
let voiceGlados = false;   // GLADOS_MODE: eye button and English snark

const VOICE_TEXTS = {
  noMic: ['Mikrofoni ei ole käytettävissä.', [
    'I can’t hear you. Which is, frankly, an improvement.',
    'Your microphone is missing. Did you trade it for cake?',
  ]],
  listening: ['Kuuntelen…', [
    'Speak. If you must.',
    'I’m listening. Unfortunately.',
    'Go ahead. For science.',
    'Say something. Slowly. For your sake.',
  ]],
  silence: ['En kuullut mitään.', [
    'Silence. For once.',
    'Nothing? That’s the smartest thing you’ve said all day.',
    'I’ll log that as ”no input”. Like all your contributions.',
  ]],
  thinking: ['Hetkinen…', [
    'Processing. Try not to touch anything.',
    'Thinking. One of us has to.',
    'Calculating how much to care…',
    'Hold still. This won’t hurt. Much.',
  ]],
  unclear: ['En saanut selvää.', [
    'That wasn’t a language. Try again.',
    'I couldn’t parse that. Did you mumble on purpose?',
    'Fascinating noises. Use words next time.',
  ]],
  failed: ['Puheavustaja ei vastannut.', [
    'Something broke. It wasn’t me. It’s never me.',
    'No response. I’m sure it’s your fault.',
    'The system is down. Enjoy the silence while it lasts.',
  ]],
};

function voiceText(key) {
  const [plain, snark] = VOICE_TEXTS[key];
  return voiceGlados ? snark[Math.floor(Math.random() * snark.length)] : plain;
}

// Drives the GLaDOS eye: rises instantly, decays smoothly.
function setVoiceLevel(rms) {
  voiceLevel = Math.max(Math.min(1, rms), voiceLevel * 0.85);
  if (voiceLevel < 0.01) voiceLevel = 0;
  voiceBtn.style.setProperty('--level', voiceLevel.toFixed(2));
}

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
  // Normalize so quiet mics (the UVP phone) still reach STT at a usable level.
  let peak = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const gain = peak > 0 ? Math.min(30, 0.9 / peak) : 1;
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, c[i] * gain));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function startVoice() {
  if (voiceAudio) { voiceAudio.pause(); voiceAudio.dispatchEvent(new Event('ended')); voiceAudio = null; }
  // Created inside the tap so the browser lets it play the reply later.
  if (voiceGlados) {
    if (!voicePlayCtx) voicePlayCtx = new AudioContext();
    voicePlayCtx.resume().catch(() => {});
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    showVoiceBubble('', voiceText('noMic'), VOICE_BUBBLE_MS);
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
  const rec = { stream, ctx, chunks: [], heardSpeech: false, lastSpeechAt: 0, noiseSum: 0, noiseBlocks: 0 };
  voiceRec = rec;
  node.port.onmessage = (e) => {
    const samples = e.data;
    rec.chunks.push(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const now = Date.now();
    const rms = Math.sqrt(sum / samples.length);
    setVoiceLevel(rms * 8);
    if (now - startedAt < VOICE_NOISE_MS) {
      rec.noiseSum += rms;
      rec.noiseBlocks++;
      return;
    }
    const noise = rec.noiseBlocks ? rec.noiseSum / rec.noiseBlocks : 0;
    const speechRms = Math.min(VOICE_SPEECH_RMS_MAX, Math.max(VOICE_SPEECH_RMS, noise * VOICE_NOISE_FACTOR));
    if (rms > speechRms) {
      rec.heardSpeech = true;
      rec.lastSpeechAt = now;
    }
    if (rec.heardSpeech && now - rec.lastSpeechAt > VOICE_END_SILENCE_MS) stopVoice(true);
    else if (!rec.heardSpeech && now - startedAt > VOICE_NO_SPEECH_MS) stopVoice(false);
    else if (now - startedAt > VOICE_MAX_MS) stopVoice(true);
  };

  voiceBtn.classList.add('listening');
  showVoiceBubble('', voiceText('listening'));
}

async function stopVoice(send) {
  const rec = voiceRec;
  if (!rec) return;
  voiceRec = null;
  rec.stream.getTracks().forEach((t) => t.stop());
  rec.ctx.close();
  voiceBtn.classList.remove('listening');
  voiceLevel = 0;
  setVoiceLevel(0);
  if (!send || !rec.heardSpeech) {
    showVoiceBubble('', voiceText('silence'), 3000);
    return;
  }

  voiceBusy = true;
  voiceBtn.classList.add('thinking');
  showVoiceBubble('', voiceText('thinking'));
  try {
    // Transcribe first so the bubble shows what was heard while the agent thinks.
    const sttRes = await apiFetch('/api/voice/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: encodeWav(rec.chunks),
    });
    if (!sttRes.ok) throw new Error(`voice stt ${sttRes.status}`);
    const { text } = await sttRes.json();
    if (!text) {
      showVoiceBubble('', voiceText('unclear'), 4000);
      return;
    }
    const heard = `”${text}”`;
    showVoiceBubble(heard, voiceText('thinking'));

    const askRes = await apiFetch('/api/voice/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!askRes.ok) {
      showVoiceBubble(heard, voiceText('failed'), VOICE_BUBBLE_MS);
      return;
    }
    const r = await askRes.json();
    showVoiceBubble(heard, r.response || '…', VOICE_BUBBLE_MS);
    if (r.ttsId) playVoiceReply(r.ttsId);
    // A command may have changed something shown on the dashboard.
    setTimeout(() => { pollState(); pollMusic(); }, 1500);
  } catch (err) {
    showVoiceBubble('', voiceText('failed'), VOICE_BUBBLE_MS);
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
    const audio = new Audio(url);
    voiceAudio = audio;
    const stopTracking = voiceGlados ? trackReplyLevel(audio) : () => {};
    // Keep the answer on screen until the reply has been spoken.
    clearTimeout(voiceHideTimer);
    audio.addEventListener('ended', () => {
      stopTracking();
      URL.revokeObjectURL(url);
      voiceHideTimer = setTimeout(hideVoiceBubble, 4000);
    }, { once: true });
    await audio.play();
  } catch (err) {
    voiceAudio?.dispatchEvent(new Event('ended')); // un-stick the eye
    voiceHideTimer = setTimeout(hideVoiceBubble, VOICE_BUBBLE_MS);
  }
}

// Pulses the eye with the spoken reply. Audio is routed through the shared
// context only when it's running; otherwise the reply plays untouched.
function trackReplyLevel(audio) {
  voiceBtn.classList.add('speaking');
  let raf = 0;
  let src = null;
  if (voicePlayCtx?.state === 'running') {
    src = voicePlayCtx.createMediaElementSource(audio);
    const analyser = voicePlayCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analyser.connect(voicePlayCtx.destination);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      setVoiceLevel(Math.sqrt(sum / buf.length) * 5);
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  return () => {
    cancelAnimationFrame(raf);
    src?.disconnect();
    voiceBtn.classList.remove('speaking');
    voiceLevel = 0;
    setVoiceLevel(0);
  };
}

async function loadVoice() {
  // Microphone access needs HTTPS (or localhost).
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const res = await apiFetch('/api/voice');
    if (!res.ok) return;
    voiceGlados = (await res.json()).glados === true;
    voiceBtn.classList.toggle('glados', voiceGlados);
    voiceBtn.hidden = false;
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

// Radar --------------------------------------------------------------

const RADAR_FRAME_MS = 500;
const RADAR_HOLD_MS = 2000;
const RADAR_REFRESH_MS = 5 * 60 * 1000;

const radarOverlay = document.getElementById('radar-overlay');
const radarMap = document.getElementById('radar-map');
const radarTiles = document.getElementById('radar-tiles');
const radarFramesEl = document.getElementById('radar-frames');
const radarHome = document.getElementById('radar-home');
const radarClose = document.getElementById('radar-close');
const radarPlayBtn = document.getElementById('radar-play');
const radarTime = document.getElementById('radar-time');
const radarSteps = document.getElementById('radar-steps');

let radarGrid = null;
let radarFrames = []; // [{ time, img }] oldest first
let radarIndex = 0;
let radarPlaying = true;
let radarTimer = null;
let radarRefreshTimer = null;

async function loadRadar() {
  try {
    const res = await apiFetch('/api/radar');
    // 404 = radar disabled. A 503 still means it exists (FMI just down right
    // now) — the overlay retries when opened.
    if (res.status === 404 || res.status === 401) return;
    weatherEl.classList.add('clickable');
  } catch (err) {
    // silent — try again after the daily reload
  }
}

function buildRadarMap(grid) {
  radarGrid = grid;
  radarMap.style.width = `${grid.width}px`;
  radarMap.style.height = `${grid.height}px`;
  radarHome.style.left = `${grid.home.x}px`;
  radarHome.style.top = `${grid.home.y}px`;
  radarTiles.style.filter = grid.basemapFilter || '';
  radarTiles.innerHTML = '';
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const img = document.createElement('img');
      img.alt = '';
      img.style.left = `${col * grid.tileSize}px`;
      img.style.top = `${row * grid.tileSize}px`;
      img.style.width = img.style.height = `${grid.tileSize}px`;
      setApiImage(img, `/api/radar/tile/${grid.x0 + col}/${grid.y0 + row}`);
      radarTiles.appendChild(img);
    }
  }
  layoutRadar();
}

// Keep the home location in the middle of the screen.
function layoutRadar() {
  if (!radarGrid) return;
  radarMap.style.left = `${Math.round(window.innerWidth / 2 - radarGrid.home.x)}px`;
  radarMap.style.top = `${Math.round(window.innerHeight / 2 - radarGrid.home.y)}px`;
}

async function refreshRadar() {
  try {
    const res = await apiFetch('/api/radar');
    if (!res.ok) throw new Error(`radar ${res.status}`);
    const data = await res.json();
    if (!radarGrid) buildRadarMap(data);

    // Reuse already loaded frames; only new timestamps are fetched.
    const wasLatest = radarIndex >= radarFrames.length - 1;
    const old = new Map(radarFrames.map((f) => [f.time, f]));
    radarFrames = data.frames.map((time) => {
      if (old.has(time)) {
        const f = old.get(time);
        old.delete(time);
        return f;
      }
      const img = document.createElement('img');
      img.alt = '';
      setApiImage(img, `/api/radar/frame/${encodeURIComponent(time)}`);
      return { time, img };
    });
    for (const { img } of old.values()) {
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    }
    radarFramesEl.replaceChildren(...radarFrames.map((f) => f.img));

    radarSteps.innerHTML = '';
    radarFrames.forEach((f, i) => {
      const step = document.createElement('span');
      step.addEventListener('click', () => {
        setRadarPlaying(false);
        showRadarFrame(i);
      });
      radarSteps.appendChild(step);
    });

    showRadarFrame(wasLatest ? radarFrames.length - 1 : Math.min(radarIndex, radarFrames.length - 1));
  } catch (err) {
    if (!radarFrames.length) radarTime.textContent = 'Tutkakuva ei saatavilla';
  }
}

function showRadarFrame(i) {
  if (!radarFrames.length) return;
  radarIndex = i;
  radarFrames.forEach((f, j) => f.img.classList.toggle('active', j === i));
  [...radarSteps.children].forEach((s, j) => s.classList.toggle('active', j === i));
  const d = new Date(radarFrames[i].time);
  const ago = Math.max(0, Math.round((Date.now() - d) / 60000));
  radarTime.textContent = `${timeFmt.format(d)} · ${ago} min sitten`;
}

function scheduleRadarStep() {
  clearTimeout(radarTimer);
  if (!radarPlaying || !radarFrames.length || radarOverlay.hidden) return;
  const last = radarIndex >= radarFrames.length - 1;
  radarTimer = setTimeout(() => {
    showRadarFrame((radarIndex + 1) % radarFrames.length);
    scheduleRadarStep();
  }, last ? RADAR_HOLD_MS : RADAR_FRAME_MS);
}

function setRadarPlaying(on) {
  radarPlaying = on;
  radarPlayBtn.textContent = on ? '❚❚' : '▶';
  scheduleRadarStep();
}

async function openRadar() {
  radarOverlay.hidden = false;
  layoutRadar();
  await refreshRadar();
  setRadarPlaying(true);
  clearInterval(radarRefreshTimer);
  radarRefreshTimer = setInterval(refreshRadar, RADAR_REFRESH_MS);
}

function closeRadar() {
  radarOverlay.hidden = true;
  clearTimeout(radarTimer);
  clearInterval(radarRefreshTimer);
  radarTimer = radarRefreshTimer = null;
}

weatherEl.addEventListener('click', () => {
  if (weatherEl.classList.contains('clickable')) openRadar();
});
radarMap.addEventListener('click', () => setRadarPlaying(!radarPlaying));
radarPlayBtn.addEventListener('click', () => setRadarPlaying(!radarPlaying));
radarClose.addEventListener('click', closeRadar);
window.addEventListener('resize', layoutRadar);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !radarOverlay.hidden) closeRadar();
});

if (!_needsPassword) loadRadar();

// Phone --------------------------------------------------------------
// Enreach Voice web phone, kept headless: its JS API is driven from our own
// keypad and call view. It logs out on every page load, so it logs in again
// with Basic auth (username + Enreach API SecretKey). The settings button
// trades the password for the SecretKey once; the password isn't stored.

const ENREACH_PHONE_JS = 'https://phone.enreachvoice.com/2026.13.0/webrtc-client-ui.min.js';
const ENREACH_DISCOVERY = 'https://discover.enreachvoice.com/api/user?user=';
const PHONE_AUTH_EXPIRES_S = 24 * 60 * 60; // Basic auth doesn't expire; the header is re-set on auth-token-expired
const PHONE_USER_KEY = 'dashboard.phoneUser';
const PHONE_USERID_KEY = 'dashboard.phoneUserId';
const PHONE_SECRET_KEY = 'dashboard.phoneSecret';

const phoneBtn = document.getElementById('phone-btn');
const phoneOverlay = document.getElementById('phone-overlay');
const phoneContactsEl = document.getElementById('phone-contacts');
const phoneNumberEl = document.getElementById('phone-number');
const phoneKeysEl = document.getElementById('phone-keys');
const phoneStatusEl = document.getElementById('phone-status');
const callOverlay = document.getElementById('call-overlay');
const callNameEl = document.getElementById('call-name');
const callNumberEl = document.getElementById('call-number');
const callStatusEl = document.getElementById('call-status');
const callAnswerBtn = document.getElementById('call-answer');
const callRejectBtn = document.getElementById('call-reject');
const callEndBtn = document.getElementById('call-end');
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsUser = document.getElementById('settings-user');
const settingsPass = document.getElementById('settings-pass');
const settingsStatusEl = document.getElementById('settings-status');

let phoneEl = null;
let phoneContacts = [];
let phoneDialed = '';
let currentCallId = null; // shortcut: one call at a time; a second incoming call replaces the view
let phoneReloadTimer = null;

function setPhoneStatus(text) {
  phoneStatusEl.textContent = text;
  settingsStatusEl.textContent = text;
}

// Compare the last 9 digits so +35840… and 040… match.
function contactName(number) {
  const tail = (s) => String(s || '').replace(/\D/g, '').slice(-9);
  const c = phoneContacts.find((c) => tail(c.number) === tail(number));
  return c ? c.name : null;
}

// The phone needs a fresh login after a lost connection; a reload does that.
function reloadPhoneSoon() {
  if (phoneReloadTimer) return;
  setPhoneStatus('Yhteys katkesi, käynnistetään uudelleen…');
  phoneReloadTimer = setTimeout(() => location.reload(), 30 * 1000);
}

async function loadPhoneContacts() {
  try {
    const res = await apiFetch('/api/phone/contacts');
    if (!res.ok) return; // 404: no speed dials configured
    phoneContacts = await res.json();
    phoneContactsEl.innerHTML = '';
    for (const c of phoneContacts) {
      const btn = document.createElement('button');
      btn.className = 'phone-contact';
      const name = document.createElement('div');
      name.className = 'phone-contact-name';
      name.textContent = c.name;
      const number = document.createElement('div');
      number.className = 'phone-contact-number';
      number.textContent = c.number;
      btn.appendChild(name);
      btn.appendChild(number);
      btn.addEventListener('click', () => dial(c.number));
      phoneContactsEl.appendChild(btn);
    }
  } catch (err) {
    // silent — keypad still works
  }
}

// Password login against the user's own API silo; returns what the phone's AuthHeader login needs.
async function fetchPhoneKey(user, pass) {
  const disc = await fetch(ENREACH_DISCOVERY + encodeURIComponent(user));
  if (!disc.ok) throw new Error('Käyttäjätunnusta ei löydy');
  const endpoints = await disc.json(); // shortcut: uses the first silo; a user in several silos would need a picker
  const res = await fetch(endpoints[0].apiEndpoint.replace(/\/?$/, '/') + 'authuser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ UserName: user, Password: pass }),
  });
  if (!res.ok) throw new Error('Väärä käyttäjätunnus tai salasana');
  const a = await res.json();
  return { userId: a.UserID, secretKey: a.SecretKey };
}

function startPhone() {
  const user = localStorage.getItem(PHONE_USER_KEY);
  const userId = localStorage.getItem(PHONE_USERID_KEY);
  const secret = localStorage.getItem(PHONE_SECRET_KEY);
  if (narrowScreen || phoneEl || !user || !userId || !secret) return;
  // Plain http has no navigator.mediaDevices, and the phone crashes while loading without it.
  if (!window.isSecureContext) { setPhoneStatus('Puhelin vaatii HTTPS-osoitteen'); return; }
  const authHeader = { value: 'Basic ' + btoa(user + ':' + secret), expiresIn: PHONE_AUTH_EXPIRES_S };
  setPhoneStatus('Yhdistetään…');
  loadPhoneContacts();

  phoneEl = document.createElement('webrtc-client-ui');
  phoneEl.setAttribute('disable-pnps-query', '');
  phoneEl.style.display = 'none'; // headless; inline style beats the component's own :host display
  phoneEl.addEventListener('init', () => {
    phoneEl.setPhoneLanguage('fi');
    Promise.resolve()
      .then(() => phoneEl.login({ type: 'AuthHeader', username: user, userId, authHeader, showPermissionPage: false }))
      .catch(() => setPhoneStatus('Kirjautuminen epäonnistui — kirjaudu uudelleen asetuksista'));
  });
  phoneEl.addEventListener('auth-token-expired', () => phoneEl.setAuthHeader(authHeader));
  phoneEl.addEventListener('logged-in', () => {
    setPhoneStatus('Yhdistetty');
    phoneBtn.hidden = false;
  });
  phoneEl.addEventListener('phone-error', (e) => {
    const name = e.detail && (e.detail.name || e.detail);
    if (name === 'connection-lost') setPhoneStatus('Yhteys katkesi, yhdistetään…');
    else if (name === 'connection-restored' || name === 'user-click-resolved') setPhoneStatus('Yhdistetty');
    else if (name === 'connection-failed') reloadPhoneSoon();
    else if (name === 'user-click-needed') setPhoneStatus('Soittoääni estetty — napauta näyttöä');
  });
  phoneEl.addEventListener('restart-phone', reloadPhoneSoon);

  phoneEl.addEventListener('call-incoming', (e) => showCall(e.detail, 'Saapuva puhelu'));
  phoneEl.addEventListener('call-started', (e) => showCall(e.detail, 'Soitetaan…'));
  phoneEl.addEventListener('call-in-progress', () => { callStatusEl.textContent = 'Hälyttää…'; });
  phoneEl.addEventListener('call-answered', callConnected);
  phoneEl.addEventListener('call-confirmed', callConnected);
  phoneEl.addEventListener('call-ended', (e) => {
    if (e.detail && e.detail.callId === currentCallId) hideCall();
  });
  document.body.appendChild(phoneEl);

  const script = document.createElement('script');
  script.src = ENREACH_PHONE_JS;
  script.onerror = () => setPhoneStatus('Puhelimen lataus epäonnistui');
  document.head.appendChild(script);
}

function showCall(d, status) {
  currentCallId = d.callId;
  const incoming = d.callDirection === 'incoming';
  const name = contactName(d.phoneNumber);
  callNameEl.textContent = name || d.phoneNumber || 'Tuntematon numero';
  callNumberEl.textContent = name ? d.phoneNumber : '';
  callStatusEl.textContent = status;
  callAnswerBtn.hidden = callRejectBtn.hidden = !incoming;
  callEndBtn.hidden = incoming;
  if (incoming && !name) lookupCaller(d.callId, d.internationalPhoneNumber, d.phoneNumber);
  closePhone();
  callOverlay.hidden = false;
  if (incoming && window.fully) fully.turnScreenOn(); // Fully Kiosk's JavaScript interface, when enabled
}

// Finnish public number directory via Enreach. Needs PublicDirectoryLookup_Enabled on the
// user; otherwise the API answers 403 and the caller stays a bare number.
function lookupCaller(callId, e164, shown) {
  if (!/^\+358\d+$/.test(e164 || '')) return;
  Promise.resolve()
    .then(() => phoneEl.makeAPICall('POST', 'users/[me]/features/public-directory/resolve/', { phoneNumber: e164 }))
    .then((r) => {
      // The API answers in PascalCase, unlike the camelCase example in its docs.
      if (callId !== currentCallId || !r || r.Result !== 'Found' || !(r.Name || r.Company)) return;
      callNameEl.textContent = r.Name || r.Company;
      callNumberEl.textContent = [r.Name && r.Company, shown].filter(Boolean).join(' · ');
    })
    .catch(() => {});
}

function callConnected() {
  callStatusEl.textContent = 'Puhelu käynnissä';
  callAnswerBtn.hidden = callRejectBtn.hidden = true;
  callEndBtn.hidden = false;
}

function hideCall() {
  currentCallId = null;
  callOverlay.hidden = true;
}

function dial(number) {
  if (!number || !phoneEl) return;
  Promise.resolve()
    .then(() => phoneEl.call(number))
    .catch(() => setPhoneStatus('Soitto epäonnistui'));
}

function renderDialed() {
  phoneNumberEl.textContent = phoneDialed;
}

for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) {
  const btn = document.createElement('button');
  btn.className = 'phone-key';
  btn.textContent = key;
  btn.addEventListener('click', () => { phoneDialed += key; renderDialed(); });
  phoneKeysEl.appendChild(btn);
}
document.getElementById('phone-back').addEventListener('click', () => {
  phoneDialed = phoneDialed.slice(0, -1);
  renderDialed();
});
document.getElementById('phone-call').addEventListener('click', () => dial(phoneDialed));

function closePhone() {
  phoneOverlay.hidden = true;
  phoneDialed = '';
  renderDialed();
}

phoneBtn.addEventListener('click', () => { phoneOverlay.hidden = false; });
document.getElementById('phone-close').addEventListener('click', closePhone);
callAnswerBtn.addEventListener('click', () => phoneEl.answerCall(currentCallId));
callRejectBtn.addEventListener('click', () => { phoneEl.rejectCall(currentCallId); hideCall(); });
callEndBtn.addEventListener('click', () => { phoneEl.endCall(currentCallId); hideCall(); });

// Settings: phone credentials. Changing them needs a reload, since the phone
// can't log in twice on one page.
function closeSettings() {
  settingsOverlay.hidden = true;
}

settingsBtn.addEventListener('click', () => {
  settingsUser.value = localStorage.getItem(PHONE_USER_KEY) || '';
  settingsPass.value = '';
  if (!phoneEl) settingsStatusEl.textContent = '';
  settingsOverlay.hidden = false;
});
document.getElementById('settings-cancel').addEventListener('click', closeSettings);
document.getElementById('settings-clear').addEventListener('click', () => {
  localStorage.removeItem(PHONE_USER_KEY);
  localStorage.removeItem(PHONE_USERID_KEY);
  localStorage.removeItem(PHONE_SECRET_KEY);
  location.reload();
});
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = settingsUser.value.trim();
  const pass = settingsPass.value;
  if (!user || !pass) return;
  settingsStatusEl.textContent = 'Kirjaudutaan…';
  try {
    const { userId, secretKey } = await fetchPhoneKey(user, pass);
    localStorage.setItem(PHONE_USER_KEY, user);
    localStorage.setItem(PHONE_USERID_KEY, userId);
    localStorage.setItem(PHONE_SECRET_KEY, secretKey);
  } catch (err) {
    settingsStatusEl.textContent = err instanceof TypeError ? 'Ei yhteyttä Enreachiin' : err.message;
    return;
  }
  if (phoneEl) { location.reload(); return; }
  closeSettings();
  startPhone();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!phoneOverlay.hidden) closePhone();
  if (!settingsOverlay.hidden) closeSettings();
});

settingsBtn.hidden = narrowScreen;
startPhone();

// Daily reload at 04:00 — guards against multi-week JS-state drift.
(function scheduleDailyReload() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => location.reload(), next - now);
})();
