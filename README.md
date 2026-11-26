<div align="center">
  <img src="./docs/assets/kallie-icon.png" alt="Kallie" width="84" />
  <h1>Kallie</h1>
  <p><strong>Voice-first AI calling assistant powered by LiveKit, Gemini Live API, NestJS, Supabase, Next.js, and Expo.</strong></p>
  <p>
    <a href="https://kallie.nozorin.com"><img src="https://img.shields.io/badge/Website-kallie.nozorin.com-000000?style=for-the-badge" alt="Website" /></a>
    <a href="https://github.com/noirelle/kallie/releases/latest"><img src="https://img.shields.io/badge/Android_APK-Latest_Release-111111?style=for-the-badge" alt="Android APK" /></a>
    <a href="https://github.com/noirelle/kallie/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/noirelle/kallie/ci.yml?branch=main&style=for-the-badge&label=CI&color=111111" alt="CI Status" /></a>
  </p>
</div>

---

## Overview

Kallie replaces traditional call-scheduling forms with natural voice interaction over low-latency WebRTC audio. During any call, you can ask Kallie to call you back or remind you at a specific time—for example, *"Call me back in 2 minutes"*, *"Remind me tomorrow at 9 AM"*, or *"Cancel my water reminder"*—and Kallie automatically initiates the callback at the scheduled time.

---

## Download and Access

<table>
  <tr>
    <td valign="middle" width="68%">
      <h3>Get Kallie</h3>
      <ul>
        <li><strong>Website:</strong> <a href="https://kallie.nozorin.com">https://kallie.nozorin.com</a></li>
        <li><strong>Android APK:</strong> <a href="https://github.com/noirelle/kallie/releases/latest">Download Latest Release</a></li>
        <li><strong>Release History:</strong> <a href="https://github.com/noirelle/kallie/releases">GitHub Releases</a></li>
      </ul>
      <p>
        Install the Android APK once. JavaScript and UI updates are delivered automatically over the air via EAS Update on push to <code>main</code>; native binary updates display an in-app download prompt linked to GitHub Releases.
      </p>
    </td>
    <td align="center" valign="middle" width="32%">
      <a href="https://github.com/noirelle/kallie/releases/latest">
        <img src="./docs/assets/android-download-qr.svg" alt="Scan to download Kallie Android APK" width="144" />
      </a>
      <br />
      <sub><strong>Scan for Android APK</strong><br /><code>releases/latest</code></sub>
    </td>
  </tr>
</table>

---

## Architecture

```text
kallie/
├── apps/
│   ├── web/            # Next.js pure-dark scroll-driven promotional & Android download site
│   └── mobile/         # Expo React Native client (Android / iOS, native WebRTC, FCM + CallKeep, OTA updates)
├── services/
│   ├── api/            # NestJS API, 15s atomic due-call scheduler, LiveKit dispatch, FCM & APNs push
│   └── agent/          # LiveKit Node.js AI voice agent (Gemini Live API + dynamic voice tools)
├── infra/
│   ├── caddy/          # Reverse proxy with automatic Let's Encrypt HTTPS (/ -> web, /api/* -> api)
│   ├── test/           # Pre-deploy preflight checks and post-deploy smoke tests
│   └── deploy-ec2.sh   # EC2 bootstrap, swap setup, GHCR pull, and verification script
├── supabase/
│   └── migrations/     # PostgreSQL schema, Row Level Security (RLS), Realtime, atomic claim RPC
└── .github/
    └── workflows/      # CI tests, GHCR Docker build & EC2 auto-deploy, EAS OTA, Android APK releases
```

### Core Call Flow

1. **Authenticated Voice Session:** Clients sign in via Supabase Auth and request a LiveKit room token from `services/api`. The API dispatches `kallie-voice-agent` and mints a participant JWT in parallel.
2. **Dynamic Voice Tools:** During a call, `services/agent` exposes four voice tools—`schedule_callback`, `list_scheduled_calls`, `cancel_scheduled_call`, and `end_call`—backed directly by Supabase PostgreSQL.
3. **Automated Scheduled Callbacks:** The NestJS scheduler polls due schedules every 15 seconds using PostgreSQL `FOR UPDATE SKIP LOCKED` (`claim_due_schedules`), creates a `ringing` session in `call_sessions`, broadcasts to open clients via Supabase Realtime, and dispatches high-priority Android FCM / iOS APNs VoIP pushes when configured.
4. **On-Accept Agent Dispatch:** The AI agent is dispatched only after the user answers an incoming callback, avoiding unnecessary compute and API usage on missed or declined calls.

---

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Website | Next.js 15, Tailwind CSS, Motion (scroll-driven landing page) |
| Mobile Client | Expo (React Native, TypeScript), Expo Router, `@livekit/react-native`, `react-native-callkeep`, `@react-native-firebase/messaging`, `expo-updates` |
| Backend API & Scheduler | NestJS, `@nestjs/schedule`, `livekit-server-sdk`, `firebase-admin`, Node.js HTTP/2 APNs |
| Voice AI Agent | `@livekit/agents`, `@livekit/agents-plugin-google` (Gemini Live API) |
| Database & Auth | Supabase (PostgreSQL, Auth, Row Level Security, Realtime) |
| Infrastructure & CI/CD | Docker, Caddy (Auto HTTPS), GitHub Container Registry (GHCR), GitHub Actions, AWS EC2, EAS |

---

## Local Development

### Prerequisites

- Node.js 22+ and npm
- Supabase project (free tier supported)
- LiveKit Cloud project (free tier supported)
- Google AI Studio API key with Gemini Live access

### 1. Apply Database Migration

Execute `supabase/migrations/001_init_schema.sql` in the Supabase SQL Editor.

### 2. Configure Environment Files

Copy each `.env.example` to `.env` (or `.env.local` for `apps/web`) and populate your keys:

- `services/api/.env`
- `services/agent/.env`
- `apps/web/.env.local`
- `apps/mobile/.env`

### 3. Install and Run

```bash
npm run install:all

# Start in separate terminals
npm run dev:api     # NestJS API & scheduler on http://localhost:3001
npm run dev:agent   # LiveKit voice agent worker
npm run dev:web     # Next.js web client on http://localhost:3000
```

---

## Verification and Testing

```bash
npm run test:infra       # Pre-deploy Docker, Caddy, and secret-hygiene checks
npm run test:api         # NestJS build and unit tests (health, calls, scheduler)
npm run test:agent       # Voice agent unit tests (metadata, voice tools, end_call)
npm run test:all         # Run all automated test suites
npm run typecheck:mobile # Expo TypeScript verification
```

---

## Deployment and Release Pipelines

### Production Server (GitHub Actions -> GHCR -> AWS EC2)

Pushes to `main` touching `services/**`, `apps/web/**`, `infra/**`, or `docker-compose.yml` trigger `.github/workflows/docker-deploy.yml`:

1. Builds `api`, `agent`, and `web` images in parallel on GitHub runners and pushes them to `ghcr.io/noirelle/kallie-*`.
2. Connects to EC2 over SSH, pulls the prebuilt images (`docker compose pull && docker compose up -d`), and verifies the live deployment with `infra/test/smoke-deploy.sh`.
3. Caddy serves `https://kallie.nozorin.com` (Web) and `https://kallie.nozorin.com/api` (API) with automatic Let's Encrypt TLS.

### Mobile Updates and Releases

- **Over-the-Air (OTA) Updates:** Pushes to `main` modifying `apps/mobile/**` run `.github/workflows/ota-update.yml` to publish updates to the `preview` and `production` EAS channels.
- **Android APK GitHub Releases:** Pushing a version tag (for example, `git tag v0.2.0 && git push origin v0.2.0`) runs `.github/workflows/android-release.yml` to build the signed `.apk` on EAS and publish it directly to GitHub Releases.

---

## License

MIT
