# Hall Dashboard — Project Plan

A self-hosted replacement for DAKboard, running in a kiosk browser on a 1st-gen Surface Pro mounted in the hall. Pulls photos from Immich, sensor values from Home Assistant, electricity prices from spot-hinta.fi, events from Google Calendar, and weather from a free API.

---

## 1. Goals & non-goals

### Goals
- Single static-ish web page running fullscreen in the Surface Pro's browser.
- Photo background that auto-cycles through photos from a self-hosted Immich album (including photos taken by spouse).
- Show the next few days of events from a shared family Google Calendar.
- Show current weather + short forecast.
- Show selected Home Assistant sensors (sauna temp, hottub temp, solar production, etc.).
- Show SPOT electricity price for the current hour and next ~12–24 hours as a chart.
- Run entirely on the home network (no cloud dependency for sensors/photos).
- Survive forever on a wall-mounted device — no manual refresh, recovers from network blips.

### Non-goals
- No interactivity / touch controls (read-only dashboard).
- No user accounts / multi-tenant.
- Not designed to render outside the home network.
- No native app — just a web page.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Surface Pro (kiosk browser, fullscreen, points to backend)  │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTP (LAN)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│           Backend service (Node.js / Fastify)                 │
│           — serves static frontend                            │
│           — proxies + caches all upstream APIs                │
│           — holds all secrets (API keys, tokens)              │
└──┬─────────────┬──────────────┬──────────────┬───────────────┘
   │             │              │              │
   ▼             ▼              ▼              ▼
Immich    Home Assistant   spot-hinta.fi   Google Calendar
(LAN)        (LAN)          (internet)        (OAuth)
                                              + Weather API
```

**Why a backend (not a pure static page)?**
1. **CORS** — Immich, HA, and Google Calendar APIs don't send permissive CORS headers; a browser-only app can't call them.
2. **Secrets** — API keys for Immich and HA must never ship to the browser.
3. **Rate limiting** — spot-hinta.fi has rate limits; cache server-side so the dashboard polling 24/7 doesn't trip them.
4. **Image proxy** — Immich requires the API key as a header on every image fetch; the backend proxies those so `<img src>` works without auth headers.
5. **Simple aggregation** — one `/api/state` poll instead of 5 separate frontend calls.

**Deployment target:** Docker container on existing Proxmox / homelab. Single image, single port.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js 20 + Fastify | Fast, tiny, great ecosystem for what we need. Could swap for Python/FastAPI if preferred — pick one and stick with it. |
| Frontend | Vanilla HTML + CSS + minimal JS (no framework) | This page runs forever on a low-power device. No build step, no framework churn, no React tax. ~200 lines of JS at most. |
| Charts | uPlot or Chart.js | uPlot is faster and lighter; either is fine. |
| Container | Docker + docker-compose | Standard for homelab. |
| Process | Single Node process serving both API and static frontend | Keep it simple. |

If you'd rather Python: FastAPI + Jinja2 + the same vanilla frontend works equally well. Pick one before starting.

---

## 4. Data sources — concrete details

### 4.1 Immich (photos)

- **Auth:** API key in `x-api-key` header. Generate in Immich web UI → Account Settings → API Keys. Recommended permissions: `asset.read`, `album.read`.
- **Endpoints we'll use:**
  - `GET /api/albums` — list albums (one-time, to find the album ID we want to use).
  - `GET /api/albums/{id}` — list assets in a given album.
  - `GET /api/assets/{id}/thumbnail?size=preview` — get a usable JPEG (preview is ~1080p, big enough for a dashboard, much faster than original).
  - Alternative: `GET /api/assets/random?count=1` — returns a random asset across the whole library.
- **Strategy:**
  1. On startup and every 6h, the backend fetches the asset list of one (or more) configured album, caches IDs in memory.
  2. Frontend asks `GET /photo/next` every N seconds. Backend picks a random asset ID (avoid repeating until pool is exhausted), returns the proxied thumbnail bytes.
  3. Frontend swaps the `<img>` src with a fade transition.
- **Spouse's photos:** create a shared album in Immich called e.g. "Hall Dashboard". Both you and your spouse add photos to it (manually or via Immich's mobile app share extension). Or — simpler — point the dashboard at an album that's already auto-populating, like "all photos from last 365 days" using Immich's smart albums if available, or just the whole library via the random endpoint.

### 4.2 Home Assistant (sensors)

- **Auth:** Long-lived access token. HA web UI → user profile → Security → "Long-lived access tokens".
- **Endpoint:** `GET http://homeassistant.local:8123/api/states/<entity_id>`
- **Strategy:** Backend has a configured list of entity IDs (e.g. `sensor.sauna_temperature`, `sensor.solar_production_now`). On every dashboard poll, backend fetches all of them in parallel (or maintains a 10-second cache) and returns a flat object: `{ sauna: 78.2, hottub: 38.1, solar_w: 1240, ... }`.
- HA is on the LAN — no HTTPS gymnastics needed. Use plain HTTP internally.

### 4.3 spot-hinta.fi (electricity)

- **No auth required**, free, rate-limited politely.
- **Endpoints:**
  - `GET https://api.spot-hinta.fi/JustNow` — current hour price + rank.
  - `GET https://api.spot-hinta.fi/Today` — array of today's hourly prices.
  - `GET https://api.spot-hinta.fi/TodayAndDayForward` — today + tomorrow when published (~14:00 Finnish time).
- **Strategy:** Backend caches the result with a 30-minute TTL (prices update on hour boundaries; tomorrow's prices appear once around 14:00). Returns to frontend as `{ now: 12.3, currency: "c/kWh", hours: [{time, price}, ...] }`.
- VAT note: spot-hinta returns prices both with and without tax. Pick one (with tax = `PriceWithTax`) and be consistent.

### 4.4 Google Calendar

- **Auth:** OAuth 2.0 with the family Google account. Scope: `https://www.googleapis.com/auth/calendar.readonly`.
- **Setup is the most painful part.** Steps:
  1. Create a project in Google Cloud Console.
  2. Enable Google Calendar API.
  3. Create OAuth 2.0 Client ID (Desktop app type).
  4. Run a one-time local script (`auth.js`) that opens a browser, you log in, the script saves a refresh token to disk.
  5. Backend uses the refresh token forever to fetch events.
- **Endpoint:** `GET https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=...&timeMax=...&singleEvents=true&orderBy=startTime`.
- **Strategy:** Backend caches events for 5 minutes. Returns `[{ summary, start, end, allDay, color }, ...]`.

### 4.5 Weather

- **Pick one (no key required is ideal):**
  - **Open-Meteo** (recommended) — fully free, no key, gives current + hourly + daily forecast. `https://api.open-meteo.com/v1/forecast?latitude=60.17&longitude=24.94&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FHelsinki`
  - OpenWeatherMap (free tier needs a key, more rate limited).
- **Strategy:** Backend caches for 15 minutes.

---

## 5. Backend API surface

The backend is the only thing the frontend talks to. Endpoints:

| Method | Path | Returns |
|---|---|---|
| GET | `/` | Static frontend HTML |
| GET | `/static/*` | CSS, JS, fonts |
| GET | `/api/state` | Aggregated JSON: weather, calendar events, HA sensors, spot prices |
| GET | `/api/photo/next?seen=id1,id2,id3` | A random photo as JPEG bytes (with `X-Asset-Id` header for client to track) |
| GET | `/api/health` | `{ ok: true, uptime, last_errors: {...} }` for debugging |

`/api/state` shape:
```json
{
  "ts": "2026-04-25T16:30:00+03:00",
  "weather": {
    "now": { "temp": 4.2, "code": 3, "icon": "cloudy" },
    "today": { "min": 1.0, "max": 7.0 },
    "tomorrow": { "min": 0.0, "max": 5.0 }
  },
  "calendar": [
    { "summary": "Football practice", "start": "2026-04-25T17:00", "end": "2026-04-25T18:30", "allDay": false }
  ],
  "sensors": {
    "sauna": { "value": 78.2, "unit": "°C", "label": "Sauna" },
    "hottub": { "value": 38.1, "unit": "°C", "label": "Hot tub" },
    "solar": { "value": 1240, "unit": "W", "label": "Solar" }
  },
  "electricity": {
    "now": 12.3,
    "currency": "c/kWh",
    "hours": [
      { "t": "2026-04-25T16:00", "price": 12.3 },
      { "t": "2026-04-25T17:00", "price": 14.1 }
    ]
  }
}
```

Frontend polls `/api/state` every 60 seconds. Photo cycles independently.

---

## 6. Frontend layout

A single 1080p (or whatever the Surface Pro is) full-screen page. Suggested layout:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│         [ FULLSCREEN PHOTO BACKGROUND, fades every 30s ]    │
│                                                              │
│  ┌──────────────────┐                  ┌──────────────────┐ │
│  │  Sat 25 Apr      │                  │   ☁ 4°C          │ │
│  │  16:30           │                  │   Today 1°/7°    │ │
│  └──────────────────┘                  └──────────────────┘ │
│                                                              │
│                                                              │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │  CALENDAR            │    │  SENSORS                 │   │
│  │  Today               │    │  Sauna     78°C          │   │
│  │   17:00 Football     │    │  Hot tub   38°C          │   │
│  │  Tomorrow            │    │  Solar     1240 W        │   │
│  │   09:00 Hairdresser  │    │                          │   │
│  └──────────────────────┘    └──────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ELECTRICITY  now 12.3 c/kWh                         │   │
│  │  [ small bar chart of next 24 hours, color-coded ]   │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

All info panels have a translucent dark background (`rgba(0,0,0,0.5)`) with a subtle blur (`backdrop-filter: blur(10px)`) so they're readable on any photo. White or light-grey text. Big, readable fonts (Inter or system sans-serif at 18–32px depending on panel).

Photo transition: 30s display, 1.5s crossfade. Use two stacked `<img>` elements and toggle opacity.

---

## 7. Configuration

Single `config.yaml` (or `.env`) in the container, mounted as a volume:

```yaml
immich:
  base_url: http://immich.lan:2283
  api_key: ${IMMICH_API_KEY}
  album_id: 1234-uuid-of-hall-album   # or "random" for whole library
  photo_interval_seconds: 30

home_assistant:
  base_url: http://homeassistant.lan:8123
  token: ${HA_TOKEN}
  sensors:
    - entity_id: sensor.sauna_temperature
      label: "Sauna"
      unit: "°C"
    - entity_id: sensor.hottub_temperature
      label: "Hot tub"
      unit: "°C"
    - entity_id: sensor.solar_power_now
      label: "Solar"
      unit: "W"
      transform: round0   # built-in transforms: round0, round1, round2, divide_1000

google_calendar:
  calendar_id: primary    # or specific shared calendar ID
  days_ahead: 5
  # OAuth tokens stored separately in /data/google-token.json

weather:
  provider: open-meteo
  latitude: 60.17
  longitude: 24.94
  timezone: Europe/Helsinki
  units: celsius

electricity:
  provider: spot-hinta-fi
  include_vat: true
  hours_ahead: 24

dashboard:
  poll_interval_seconds: 60
  language: en           # en | fi
  theme: dark
```

---

## 8. Project structure

```
hall-dashboard/
├── README.md
├── docker-compose.yml
├── Dockerfile
├── package.json
├── config.example.yaml
├── .env.example
├── src/
│   ├── server.ts               # Fastify app entry
│   ├── config.ts               # Config loading + validation
│   ├── routes/
│   │   ├── state.ts
│   │   ├── photo.ts
│   │   └── health.ts
│   ├── sources/
│   │   ├── immich.ts
│   │   ├── homeassistant.ts
│   │   ├── spotHinta.ts
│   │   ├── googleCalendar.ts
│   │   └── weather.ts
│   ├── lib/
│   │   ├── cache.ts            # tiny in-memory TTL cache
│   │   └── log.ts
│   └── auth/
│       └── google-oauth-cli.ts # one-shot script for token generation
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── icons/                  # weather icons (SVG)
└── data/                       # mounted volume: tokens, cache
    └── google-token.json
```

---

## 9. Build phases (order of work for Claude Code)

Build this in vertical slices — get one feature end-to-end, then add the next. Don't try to wire everything up before any of it works.

### Phase 0 — Skeleton (~30 min)
- `npm init`, install Fastify, set up TypeScript or plain JS (your call — plain JS is fine for a project this size).
- `GET /` serves a hardcoded HTML "Hello dashboard".
- `GET /api/health` returns `{ ok: true }`.
- Dockerfile builds, container runs, page loads on `http://localhost:3000`.

### Phase 1 — Photos (Immich)
- Backend: implement `src/sources/immich.ts` — fetch album asset list, cache IDs, expose `getRandomPhoto()` returning JPEG bytes.
- Backend: `GET /api/photo/next` proxies the bytes with correct content-type.
- Frontend: full-page `<img>`, swap src every 30s with fade.
- **Done when:** photos from the configured Immich album cycle on screen.

### Phase 2 — Time, weather
- Frontend: clock + date in top-left, updates every second.
- Backend: `src/sources/weather.ts` — Open-Meteo fetcher with 15min cache.
- Backend: `GET /api/state` returns `{ weather }` for now.
- Frontend: weather panel top-right.
- **Done when:** current temp + today's high/low visible.

### Phase 3 — Calendar
- One-time OAuth dance via `src/auth/google-oauth-cli.ts`. Document this clearly in README.
- Backend: `src/sources/googleCalendar.ts` — fetch upcoming events, cache 5min.
- Add `calendar` to `/api/state`.
- Frontend: events panel.
- **Done when:** next ~5 days of events visible, refreshes every minute.

### Phase 4 — Home Assistant sensors
- Backend: `src/sources/homeassistant.ts` — fetch each configured entity in parallel, cache 10s.
- Add `sensors` to `/api/state`.
- Frontend: sensors panel rendering all configured entries with their labels and units.
- **Done when:** sauna/hottub/solar all show up live.

### Phase 5 — Electricity prices
- Backend: `src/sources/spotHinta.ts` — fetch `Today` and `TodayAndDayForward`, cache 30min.
- Add `electricity` to `/api/state`.
- Frontend: bar chart panel. Color bars by relative price (cheap = green, average = yellow, expensive = red). Highlight the current hour.
- **Done when:** current price + chart of next 24h visible.

### Phase 6 — Polish & deploy
- Crossfade transitions on photos.
- Error states: if a source fails, that panel shows last-known value + a small dot indicator (no big error messages — the dashboard should degrade gracefully).
- Auto-reload page once a day at 4am (in case JS state drifts after weeks of uptime).
- Kiosk mode setup notes for the Surface Pro (Edge / Chrome `--kiosk` flag, disable sleep, autostart).
- Production docker-compose with restart policies.

---

## 10. Reliability concerns (this thing runs on a wall, forever)

- **No source should crash the dashboard.** Each source has a try/catch; on failure, the cached/last-known value is served. The frontend never sees a 500.
- **Dashboard reloads itself** at a configured time daily (default 04:00). One line of JS: `setTimeout(() => location.reload(), msUntil4am)`.
- **Backend logs to stdout** — Docker captures it, you can `docker logs` to debug.
- **Health endpoint** exposes per-source last-success timestamps so you can curl it from HA and alert if anything's been broken for >1h.
- **Image preloading** — load the next photo into a hidden `<img>` before swapping, so the fade is smooth.

---

## 11. Open questions to decide before coding

These are decisions Claude Code shouldn't make for you — answer them first:

1. **Backend language:** Node.js or Python? (Plan above assumes Node; equally fine in Python.)
2. **Immich album strategy:** dedicated "Hall" album that you both add to, or whole library random, or smart album by date range?
3. **Calendar:** primary calendar, or specific shared family calendar ID?
4. **Sensors:** what are the exact `entity_id`s in your HA?
5. **Locale:** Finnish or English UI?
6. **Surface Pro browser:** Edge or Chrome? (Both support kiosk mode; pick one.)
7. **Where will it be deployed:** Proxmox LXC, Docker on existing host, k8s, or something else?

---

## 12. What to hand to Claude Code

Tell Claude Code:

> "Read `dashboard-plan.md`. Start at Phase 0 and work through phase-by-phase. After each phase, show me what you've built and wait for confirmation before moving to the next phase. Use Node.js + Fastify + plain JS for the frontend. Keep the codebase small — this is a personal home project, not enterprise software. Don't add tests, don't add a build step for the frontend, don't add a state management library. When something needs configuration I haven't given, ask me before assuming."

Then start with: `git init` in an empty directory, `cp` the plan in, and let Claude Code rip through Phase 0.
