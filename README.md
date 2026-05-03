# home-dashboard

A self-hosted fullscreen dashboard for a wall-mounted kiosk display. Aggregates family photos from Immich, Home Assistant sensors, electricity spot prices, Google Calendar events, and weather — all on a single always-on page with no user interaction required.

Built as a DAKboard replacement running on a 1st-gen Surface Pro.

## Features

- **Photos** — cycles through Immich photos of selected people, with location/date caption
- **Clock & date** — top-left, updates every second
- **Weather** — current conditions + 5-hour hourly forecast + 2-day outlook (Open-Meteo, no API key needed)
- **Calendar** — upcoming events from Home Assistant calendar entities
- **Sensors** — Home Assistant sensor values; click to expand into 12-hour history charts
- **Electricity prices** — Finnish spot prices (spot-hinta.fi) with color-coded bar chart; click to toggle compact/expanded
- **Cameras** — button opens a 2×2 live view of Frigate (or any HA) cameras; tap a tile to go fullscreen, tap again to return to the grid

## Stack

Node.js 20 + Fastify backend, vanilla HTML/CSS/JS frontend. No build step. Single Docker container.

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

## Configuration

Copy `.env.example` to `.env` and set the values below.

| Variable | Required | Description |
|---|---|---|
| `DASHBOARD_PASSWORD` | no | Password shown as a one-time prompt; stored in browser localStorage. Leave empty to disable. |
| `IMMICH_BASE_URL` | yes | Base URL of your Immich instance |
| `IMMICH_API_KEY` | yes | Immich API key |
| `IMMICH_PERSON_IDS` | yes | Comma-separated person UUIDs to include in the photo pool |
| `IMMICH_PHOTO_INTERVAL_SECONDS` | no | Seconds between photo changes (default 300) |
| `WEATHER_LATITUDE` | yes | Decimal latitude |
| `WEATHER_LONGITUDE` | yes | Decimal longitude |
| `WEATHER_TIMEZONE` | no | IANA timezone name (default UTC) |
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

## Health check

`GET /api/health` returns uptime and per-source last-success timestamps, suitable for external monitoring.
