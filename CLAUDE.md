# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-code. The repo currently contains only `dashboard-plan.md`. Read it before doing anything — it is the source of truth for goals, architecture, data sources, API shape, config schema, project layout, and the phased build order. This CLAUDE.md only captures things that won't be obvious from re-reading the plan.

## What this is

A self-hosted DAKboard replacement: a single fullscreen web page running in a kiosk browser on a wall-mounted 1st-gen Surface Pro. Aggregates Immich photos, Home Assistant sensors, spot-hinta.fi electricity prices, Google Calendar events, and Open-Meteo weather. Read-only, LAN-only, runs forever.

## Architecture in one sentence

A single Node.js + Fastify process serves both the static frontend and an `/api/state` aggregator that proxies and caches all upstream APIs server-side. The frontend never talks to Immich/HA/Google directly — that's deliberate (CORS, secrets, rate limits, image auth headers). See `dashboard-plan.md` §2 and §5 for the full rationale and API surface.

## Stack decisions (already made — don't relitigate)

- **Backend:** Node.js 20 + Fastify, plain JS or TypeScript (project's call, not Claude's).
- **Frontend:** Vanilla HTML/CSS/JS. **No framework, no build step, no bundler, no state library.** This page must survive years of uptime on a low-power device.
- **Charts:** uPlot or Chart.js.
- **Deploy:** Single Docker container with a mounted config + token volume.

## Working style for this repo (from plan §12)

- Build in **vertical slices**: get one data source end-to-end (backend fetcher → `/api/state` field → frontend panel) before starting the next. Phases are listed in `dashboard-plan.md` §9 — follow that order.
- After each phase, stop and show the user what works. Don't chain phases without confirmation.
- This is a personal home project, not enterprise software. **No tests, no frontend build step, no state management library.** Keep it small.
- When config or a decision is missing (album ID, exact HA `entity_id`s, locale, etc. — see plan §11), **ask before assuming**.

## Reliability constraints (plan §10)

These shape every source module:

- A failing upstream must never crash the page or surface a 500 — each source wraps fetches in try/catch and serves last-known cached value on failure.
- Per-source TTL caches are mandatory (Immich 6h asset list, HA 10s, spot-hinta 30min, calendar 5min, weather 15min). The frontend polls `/api/state` every 60s and that must not fan out into 5 fresh upstream calls.
- The frontend self-reloads daily at 04:00 to shake off any drift from week-long uptime.
- `/api/health` exposes per-source last-success timestamps for external alerting.

## Project layout target

`dashboard-plan.md` §8 specifies the target directory layout (`src/server.ts`, `src/sources/*.ts`, `src/routes/*.ts`, `public/`, `data/` for tokens). Follow it; don't invent a new structure.

## Commands

None yet — no `package.json` exists. Once Phase 0 lands, expect `npm run dev` / `npm start` and `docker compose up`. Update this section when those exist.
