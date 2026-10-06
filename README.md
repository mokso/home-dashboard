# home-dashboard

A self-hosted fullscreen dashboard for a wall-mounted kiosk display. Aggregates family photos from Immich, Home Assistant sensors, electricity spot prices, Google Calendar events, and weather on a single always-on page. It works as a glanceable display with no interaction needed, and optionally adds touch controls, music playback and a voice assistant through Home Assistant.

Built as a DAKboard replacement running on a 1st-gen Surface Pro.

## Features

- **Photos** — cycles through Immich photos of selected people, with location/date caption
- **Clock & date** — top-left, updates every second
- **Weather** — current conditions + hourly forecast + 2-day outlook (Open-Meteo, no API key needed)
- **Rain radar** — tap the weather panel for a fullscreen radar map around home, looping the last hour (Finnish Meteorological Institute open data, no API key)
- **Calendar** — upcoming events from Home Assistant calendar entities
- **Sensors** — Home Assistant sensor values; click to expand into 12-hour history charts
- **Electricity prices** — Finnish spot prices (spot-hinta.fi) with color-coded bar chart; click to toggle compact/expanded
- **Cameras** — button opens a 2×2 live view of Frigate (or any HA) cameras; tap a tile to go fullscreen, tap again to return to the grid
- **Controls** — button opens a tile overlay of Home Assistant toggles (switches, lights, input booleans) and climate tiles (target temperature −/+ and heat/cool/auto/off modes)
- **Music** — a music button (animated while playing) opens a fullscreen music view: cover art, progress bar with seek, play/pause/skip, shuffle/repeat, volume, next track and speaker picker, plus the Music Assistant library (recently played, playlists, albums, artists) to start something new
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

Controls use numbered env vars like sensors (`CONTROL_1_*` … `CONTROL_20_*`). The controls button is hidden when none are configured.

| Suffix | Required | Description |
|---|---|---|
| `_ENTITY` | yes | HA entity ID |
| `_LABEL` | no | Tile label (default: entity ID) |
| `_STATUS_ENTITY` | no | Sensor whose state is shown on an on/off tile instead of Päällä/Pois. Known values (`starting`, `running`, `stopping`, `deallocating`, `deallocated`, …, e.g. an Azure VM power state) are translated, and the tile stays locked while the status is `starting`/`stopping`/`deallocating`/`restarting`. |

The tile type follows the entity's domain:

- `switch.*`, `light.*`, `input_boolean.*` (anything with `turn_on`/`turn_off`) — on/off tile
- `climate.*` — double-width tile with current temperature, target temperature −/+ (in the device's own step, within its min/max) and Off/Heat/Cool/Auto mode buttons (only the modes the device supports)

After an on/off tap, the tile shows "Käynnistyy…"/"Sammuu…" and is locked until the entity actually reaches the requested state (or 10 minutes pass). The lock is kept on the server, so a second tap from another device is rejected too. This matters for slow switches, such as one that starts a cloud VM through an automation. While the overlay is open, on/off tiles refresh every 5 seconds.

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
| `MUSIC_PLAYER` | no | A Music Assistant `media_player` entity. Leave unset to disable music entirely. This is the default speaker. |
| `MUSIC_SPEAKERS` | no | Comma-separated Music Assistant players to choose from, each optionally `entity=Label` (default label: HA friendly name). `MUSIC_PLAYER` is always included. The picker is hidden with only one speaker. |
| `MUSIC_LIBRARY_LIMIT` | no | Maximum items per library tab (default 500) |
| `MUSIC_ASSISTANT_URL` | no | Music Assistant server, e.g. `http://192.168.1.10:8095`. Used only for the "Viimeksi soitetut" (recently played) tab. |
| `MUSIC_ASSISTANT_TOKEN` | no | Long-lived Music Assistant token for the above (create one in Music Assistant's settings). Without URL and token the recently played tab is hidden. |

- The music button sits in the bottom-left row and shows bouncing bars while something plays. It opens the music view, which closes after 3 minutes without touches.
- The library tabs list your Music Assistant playlists, albums and artists, favourites first. The list refreshes every 10 minutes; no restart needed. Tapping an item replaces the queue and starts playback on the selected speaker.
- Recently played is read straight from the Music Assistant API, because HA's library service can't tell never-played items apart. The token is only used for that read; all playback goes through HA.
- Choosing another speaker while music plays moves the queue there (`music_assistant.transfer_queue`). The selected speaker is kept in memory and resets to `MUSIC_PLAYER` when the server restarts.
- "Seuraavaksi" shows the next track in the queue. HA has no service to jump to an arbitrary queue item, so the queue itself isn't browsable.
- Requires the Music Assistant integration in Home Assistant. Use the Music Assistant player entity (the one with `app_id: music_assistant`), not a duplicate entity from another integration such as Google Cast.

### Voice assistant

| Variable | Required | Description |
|---|---|---|
| `VOICE_STT` | no | HA speech-to-text entity, e.g. `stt.home_assistant_cloud`. Leave unset to hide the mic button. |
| `VOICE_TTS` | no | HA text-to-speech entity for spoken replies; without it replies are text only. Works with Piper (`tts.piper`); if the engine rejects `VOICE_LANGUAGE` the engine's default voice is used |
| `VOICE_AGENT` | no | Conversation agent (default `conversation.home_assistant`), typically an LLM agent such as `conversation.gpt_5_4_mini` that also answers free-form questions. |
| `VOICE_PREFER_LOCAL` | no | `true` (default): try HA's built-in agent first and only use `VOICE_AGENT` when it doesn't understand the sentence, like HA's "prefer handling commands locally". `false`: always use `VOICE_AGENT`. |
| `VOICE_LANGUAGE` | no | Speech language (default `fi-FI`) |
| `GLADOS_MODE` | no | `true`: the mic button becomes a GLaDOS eye (it reacts to your voice, spins while thinking and pulses with the spoken reply) and the bubble's status texts become snarky English lines. Default `false`: mic icon and Finnish texts. |

Tap the mic, speak, and recording stops automatically after a short pause (or tap again to stop). The transcript and answer appear in a bubble and the reply is spoken on the kiosk. Follow-up questions within 5 minutes continue the same conversation. With the built-in agent tried first, known commands ("sytytä pihavalot", "mikä on ulkolämpötila") answer in well under a second; anything else goes to the LLM agent and takes a few seconds.

The voice assistant can do anything your HA exposes to Assist, not just the dashboard's controls. Review **Settings → Voice assistants → Expose** in Home Assistant.

### Rain radar

On by default and centred on `WEATHER_LATITUDE`/`WEATHER_LONGITUDE`. Radar data is the [FMI](https://en.ilmatieteenlaitos.fi/open-data) Finland composite (5-minute steps), so it only covers Finland and its surroundings. Tap the weather panel to open it; tap the map or ▶/❚❚ to pause, tap a step to jump to that frame.

| Variable | Required | Description |
|---|---|---|
| `RADAR_ENABLED` | no | `false` hides the radar (default `true`) |
| `RADAR_ZOOM` | no | Map zoom level 5–12 (default `9`, roughly 190 × 110 km on a 1280 × 720 screen; each step halves/doubles the area) |
| `RADAR_FRAMES` | no | Number of 5-minute frames in the loop (default `12` = 1 hour, max 36) |
| `RADAR_BASEMAP_URL` | no | Base map tile URL template with `{z}`/`{x}`/`{y}` (default OpenStreetMap) |
| `RADAR_BASEMAP_FILTER` | no | CSS filter applied to the base map (default darkens OSM tiles; set empty for an already dark tile set) |

Base map tiles (a fixed 9 × 7 tile grid) are cached in memory for the life of the process, radar frames per timestamp. FMI is polled at most every 2 minutes and only while someone has the radar open.

## Security

The dashboard started read-only; with controls, music or voice enabled it can change things in your home. It is meant for a trusted LAN:

- Set `DASHBOARD_PASSWORD` — it protects every `/api/*` route, including the ones that switch devices.
- Controls are allowlisted: only entities in `CONTROL_N_ENTITY` can be switched, and climate requests are validated against the device's own limits and modes.
- Music only plays items from the library listing the server itself served, only on speakers listed in `MUSIC_PLAYER`/`MUSIC_SPEAKERS`, and commands are a fixed set (play/pause, skip, volume, seek, shuffle, repeat).
- Don't expose the dashboard to the internet.

## Health check

`GET /api/health` returns uptime and per-source last-success timestamps (including `music`, `voice` and `radar`), suitable for external monitoring.
