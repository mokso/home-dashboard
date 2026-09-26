# home-dashboard

A self-hosted fullscreen dashboard for a wall-mounted kiosk display. Aggregates family photos from Immich, Home Assistant sensors, electricity spot prices, Google Calendar events, and weather on a single always-on page. It works as a glanceable display with no interaction needed, and optionally adds touch controls, music playback and a voice assistant through Home Assistant.

Built as a DAKboard replacement running on a 1st-gen Surface Pro.

## Features

- **Photos** — cycles through Immich photos of selected people, with location/date caption
- **Clock & date** — top-left, updates every second
- **Weather** — current conditions + hourly forecast + 2-day outlook (Open-Meteo, no API key needed)
- **Calendar** — upcoming events from Home Assistant calendar entities
- **Sensors** — Home Assistant sensor values; click to expand into 12-hour history charts
- **Electricity prices** — Finnish spot prices (spot-hinta.fi) with color-coded bar chart; click to toggle compact/expanded
- **Cameras** — button opens a 2×2 live view of Frigate (or any HA) cameras; tap a tile to go fullscreen, tap again to return to the grid
- **Controls** — button opens a tile overlay of Home Assistant toggles (switches, lights, input booleans) and climate tiles (target temperature −/+ and heat/cool/auto/off modes)
- **Music** — a now-playing card (cover art, play/pause, skip, volume) appears at the top while a Music Assistant player is playing; Music Assistant favourites show up as one-tap presets in the controls overlay
- **Voice assistant** — tap-to-talk mic button that runs speech through Home Assistant Assist (speech-to-text → conversation agent → spoken reply)

## Stack

Node.js 20 + Fastify backend, vanilla HTML/CSS/JS frontend. No build step. Single Docker container.

The browser only ever talks to this backend. All Home Assistant, Immich and other upstream calls happen server-side, so the HA token never reaches the kiosk.

## Running locally

```bash
cp .env.example .env
# fill in your values
npm install
npm run dev
```

Open `http://localhost:3000`.

## Running in production

Uses a pre-built image from GitHub Container Registry:

```bash
cp .env.example .env
# fill in your values
docker compose -f docker-compose.prod.yml up -d
```

The image is rebuilt automatically on every push to `main` via GitHub Actions.

To build and run locally from source:

```bash
docker compose up -d
```

The voice assistant needs the dashboard to be served over **HTTPS** (browsers only allow microphone access on secure origins). Put it behind a reverse proxy such as Nginx Proxy Manager or Caddy; the mic button stays hidden on plain HTTP.

## Configuration

Copy `.env.example` to `.env` and set the values below.

| Variable | Required | Description |
|---|---|---|
| `DASHBOARD_PASSWORD` | no | Password shown as a one-time prompt; stored in browser localStorage. Leave empty to disable. Strongly recommended if you enable controls, music or voice. |
| `DASHBOARD_TITLE` | no | Browser tab title (default `Family Dashboard`) |
| `IMMICH_BASE_URL` | yes | Base URL of your Immich instance |
| `IMMICH_API_KEY` | yes | Immich API key |
| `IMMICH_PERSON_IDS` | yes | Comma-separated person UUIDs to include in the photo pool |
| `IMMICH_PHOTO_INTERVAL_SECONDS` | no | Seconds between photo changes (default 300) |
| `WEATHER_LATITUDE` | yes | Decimal latitude |
| `WEATHER_LONGITUDE` | yes | Decimal longitude |
| `WEATHER_TIMEZONE` | no | IANA timezone name (default UTC) |
| `WEATHER_HOURLY_COUNT` | no | Number of hourly forecasts shown (default 5) |
| `HA_BASE_URL` | yes | Home Assistant base URL |
| `HA_TOKEN` | yes | Home Assistant long-lived access token |
| `CALENDAR_ENTITIES` | no | Comma-separated HA calendar entity IDs |
| `CALENDAR_DAYS_AHEAD` | no | Days of events to show (default 5) |
| `ELEC_GREEN_BELOW` | no | Price threshold for green (default 10 c/kWh) |
| `ELEC_RED_ABOVE` | no | Price threshold for red (default 20 c/kWh) |
| `CAMERA_ENTITIES` | no | Comma-separated HA camera entity IDs; camera button hidden if unset |

### Sensors

Sensors are configured with numbered env vars (`SENSOR_1_*`, `SENSOR_2_*`, …, up to 20). Gaps in numbering are skipped, so you can comment out individual sensors freely.

| Suffix | Required | Description |
|---|---|---|
| `_ENTITY` | yes | HA entity ID — omitting this skips the slot |
| `_LABEL` | no | Display name (default: entity ID) |
| `_UNIT` | no | Unit string shown after the value |
| `_DECIMALS` | no | Decimal places after rounding (default 0) |
| `_MULTIPLIER` | no | Multiply raw value before rounding, e.g. `0.001` to convert W → kW (default 1) |
| `_SHOW_ABOVE` | no | Only show this sensor when its raw value exceeds this number |
| `_TEXT` | no | `true` for sensors with text states (e.g. Idle/Charging); shows a timeline instead of a chart when expanded |

Example:

```env
SENSOR_1_ENTITY=sensor.outdoor_temperature
SENSOR_1_LABEL=Outside
SENSOR_1_UNIT=°C

SENSOR_2_ENTITY=sensor.inverter_pv_power
SENSOR_2_LABEL=Solar
SENSOR_2_UNIT=kW
SENSOR_2_MULTIPLIER=0.001
SENSOR_2_DECIMALS=1
```

### Controls

Controls use numbered env vars like sensors (`CONTROL_1_*` … `CONTROL_20_*`). The controls button is hidden when none are configured (and no music presets exist).

| Suffix | Required | Description |
|---|---|---|
| `_ENTITY` | yes | HA entity ID |
| `_LABEL` | no | Tile label (default: entity ID) |

The tile type follows the entity's domain:

- `switch.*`, `light.*`, `input_boolean.*` (anything with `turn_on`/`turn_off`) — on/off tile
- `climate.*` — double-width tile with current temperature, target temperature −/+ (in the device's own step, within its min/max) and Off/Heat/Cool/Auto mode buttons (only the modes the device supports)

Only entities listed here can be changed through the dashboard; the backend rejects anything else, even though the HA token itself could control more.

```env
CONTROL_1_ENTITY=light.garden
CONTROL_1_LABEL=Garden lights
CONTROL_2_ENTITY=climate.downstairs
CONTROL_2_LABEL=Downstairs
```

### Music

| Variable | Required | Description |
|---|---|---|
| `MUSIC_PLAYER` | no | A Music Assistant `media_player` entity. Leave unset to disable music entirely. |
| `MUSIC_PRESET_LIMIT` | no | Maximum number of favourite presets shown (default 8) |

- The now-playing card is shown only while the player is playing or paused.
- Presets are your Music Assistant **favourites** (playlists, radio stations, albums, artists — star them in the Music Assistant app). The list refreshes every 10 minutes; no restart needed. Tapping a preset replaces the queue and starts playback.
- Requires the Music Assistant integration in Home Assistant. Use the Music Assistant player entity (the one with `app_id: music_assistant`), not a duplicate entity from another integration such as Google Cast.

### Voice assistant

| Variable | Required | Description |
|---|---|---|
| `VOICE_STT` | no | HA speech-to-text entity, e.g. `stt.home_assistant_cloud`. Leave unset to hide the mic button. |
| `VOICE_TTS` | no | HA text-to-speech entity for spoken replies; without it replies are text only |
| `VOICE_AGENT` | no | Conversation agent (default `conversation.home_assistant`). An LLM agent also answers free-form questions. |
| `VOICE_LANGUAGE` | no | Speech language (default `fi-FI`) |

Tap the mic, speak, and recording stops automatically after a short pause (or tap again to stop). The transcript and answer appear in a bubble and the reply is spoken on the kiosk. Follow-up questions within 5 minutes continue the same conversation.

The voice assistant can do anything your HA exposes to Assist, not just the dashboard's controls. Review **Settings → Voice assistants → Expose** in Home Assistant.

## Security

The dashboard started read-only; with controls, music or voice enabled it can change things in your home. It is meant for a trusted LAN:

- Set `DASHBOARD_PASSWORD` — it protects every `/api/*` route, including the ones that switch devices.
- Controls are allowlisted: only entities in `CONTROL_N_ENTITY` can be switched, and climate requests are validated against the device's own limits and modes.
- Music presets only play items that are currently Music Assistant favourites.
- Don't expose the dashboard to the internet.

## Health check

`GET /api/health` returns uptime and per-source last-success timestamps (including `music` and `voice`), suitable for external monitoring.
