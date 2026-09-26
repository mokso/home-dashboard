# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Built and running in production. `dashboard-plan.md` is the original plan and still the reference for goals, architecture and reliability rules, but the app has grown past it: sensors history, cameras, HA controls, Music Assistant and a voice assistant were added later. `README.md` documents every feature and env var — keep it up to date when adding or changing one.

## What this is

A self-hosted DAKboard replacement: a single fullscreen web page running in a kiosk browser on a wall-mounted 1st-gen Surface Pro. Aggregates Immich photos, Home Assistant sensors, spot-hinta.fi electricity prices, calendar events (via HA calendar entities) and Open-Meteo weather. LAN-only, runs forever, served over HTTPS through the user's Nginx Proxy Manager.

It is **no longer read-only**: controls, music and voice can change things in the house through Home Assistant. See "Write paths" below.

## Architecture in one sentence

A single Node.js + Fastify process serves both the static frontend and the `/api/*` routes that proxy and cache all upstream APIs server-side. The frontend never talks to Immich/HA/Spotify-CDN or anything else directly — that's deliberate (CORS, secrets, rate limits, image auth headers). Images and audio from HA are proxied through the backend too.

## Stack decisions (already made — don't relitigate)

- **Backend:** Node.js 20 + Fastify, plain JS (ES modules). No dependencies beyond `fastify` and `@fastify/static` — use global `fetch`, avoid adding packages (e.g. voice uses HA's REST STT/conversation/TTS endpoints rather than the websocket pipeline to avoid a `ws` dependency on Node 20).
- **Frontend:** Vanilla HTML/CSS/JS in `public/`. **No framework, no build step, no bundler, no state library.** This page must survive years of uptime on a low-power device.
- **Deploy:** Single Docker container (`node:20-alpine`), image built to GHCR on push to `main`.
- **UI language:** Finnish (`fi-FI`) for all user-facing strings.

## Working style for this repo

- Build in **vertical slices**: one feature end-to-end (source/route → API → frontend) before starting the next. After each, stop and show the user what works.
- This is a personal home project, not enterprise software. **No tests, no frontend build step, no state management library.** Keep it small.
- When config or a decision is missing (entity IDs, which player, which agent, etc.), **ask before assuming**. Entity IDs can be looked up from HA's `/api/states` using `HA_TOKEN` from `.env` — do that rather than guessing.
- Don't trigger real device changes (toggles, playback, thermostat) while testing without the user's OK; test write routes with invalid/rejected requests instead.

## Conventions

- **Config** lives in env vars parsed in `src/config.js`. Repeated items use numbered vars (`SENSOR_N_*`, `CONTROL_N_*`, up to 20). Every new var goes in `.env.example` with a comment and in the README tables.
- **Optional features** register their routes only when configured, and the frontend hides the corresponding button/panel when the route 404s or returns an empty list.
- **Overlays** (cameras, controls) open from round buttons in the bottom-left `.fab-row`.
- **Auth:** when `DASHBOARD_PASSWORD` is set, an `onRequest` hook checks `X-Dashboard-Password` on all `/api/*` routes. Frontend calls go through `apiFetch()`; images/audio loaded from the API use `setApiImage()` / blob URLs so the header is sent.
- Some files have CRLF line endings; multi-line find/replace edits must account for that.

## Write paths (HA controls, music, voice)

These routes change real state in the house — keep them tightly scoped:

- `POST /api/controls/:index` only acts on entities listed in `CONTROL_N_ENTITY`; climate requests are validated against the entity's `min_temp`/`max_temp`/`hvac_modes`.
- `POST /api/music/play` only plays URIs that are currently Music Assistant favourites; `POST /api/music/command` only accepts a fixed set of actions on `MUSIC_PLAYER`.
- `POST /api/voice` can reach anything HA exposes to Assist — that exposure is managed in HA, not here.
- Never pass the HA token or HA-signed URLs (e.g. `entity_picture`, which contains an access token) to the frontend.

## Reliability constraints (plan §10)

These shape every source module:

- A failing upstream must never crash the page or surface a 500 — wrap fetches in try/catch and serve last-known cached value on failure (`ttlCache` in `src/lib/cache.js`).
- Per-source TTL caches are mandatory (Immich 6h asset list, HA sensors 10s, spot-hinta 30min, calendar 5min, weather 15min, music player 2s, music favourites 10min). The frontend polls `/api/state` every 60s and that must not fan out into fresh upstream calls.
- The frontend self-reloads daily at 04:00 to shake off any drift from week-long uptime.
- `/api/health` exposes per-source last-success timestamps (`recordSuccess`/`recordError` in `src/lib/health.js`) for external alerting.

## Layout

- `src/server.js` — Fastify setup, auth hook, route registration
- `src/config.js` — all env parsing
- `src/sources/*.js` — upstream fetchers with caching (immich, weather, calendar, electricity, sensors, music)
- `src/routes/*.js` — HTTP routes (state, photo, sensors, cameras, controls, music, voice)
- `src/lib/` — `cache.js` (TTL cache), `health.js`
- `public/` — `index.html`, `app.js`, `style.css`

## Commands

- `npm run dev` — run with `--watch`, loads `.env`
- `npm start` — run once, loads `.env`
- `docker compose up -d` — build and run from source
- `docker compose -f docker-compose.prod.yml up -d` — run the GHCR image
