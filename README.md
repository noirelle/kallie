<p align="left">
  <img src="./docs/assets/kallie-icon.png" alt="Kallie Logo" width="72" />
</p>

# Kallie

Kallie is a voice-first AI calling assistant built with LiveKit, Gemini Live API, NestJS, Supabase, Next.js, and Expo (React Native). Users converse directly with the AI over low-latency WebRTC audio and manage future callbacks and reminders purely by voice—such as asking to be called back in two minutes, reminded at a specific time, or have upcoming callbacks listed or cancelled—without traditional scheduling forms.

---

## Download and Access

| Platform | Access |
| --- | --- |
| **Web App** | [https://kallie.nozorin.com](https://kallie.nozorin.com) |
| **Android App (APK)** | [Download Latest Release](https://github.com/noirelle/kallie/releases/latest) |
| **All Releases** | [GitHub Releases](https://github.com/noirelle/kallie/releases) |

### Scan to Download Android APK

<img src="./docs/assets/android-download-qr.svg" alt="Scan to download Kallie Android APK from GitHub Releases" width="180" />

Scan the QR code with your Android camera to open the latest release and install the `.apk`. Future UI and JavaScript updates are delivered automatically over the air via EAS Update; native binary updates prompt inside the app via GitHub Releases.

---

## Architecture

```text
kallie/
├── apps/
│   ├── web/            # Next.js client based on LiveKit agent-starter-react (dark theme)
│   └── mobile/         # Expo React Native client (Android / iOS, native WebRTC, FCM + CallKeep, OTA updates)
├── services/
│   ├── api/            # NestJS API, atomic due-call scheduler, LiveKit dispatch, FCM & APNs push services
│   └── agent/          # LiveKit Node.js AI voice agent (Gemini Live API + dynamic voice tools)
├── supabase/
│   └── migrations/     # PostgreSQL schema, Row Level Security (RLS), Realtime, atomic claim RPC
└── .github/
    └── workflows/      # Automated EAS OTA updates and Android APK release builds
```

### Core Flow

1. **Voice Session:** The client authenticates with Supabase and requests a LiveKit room token from `services/api`. The API dispatches `kallie-voice-agent` and mints a participant JWT in parallel.
2. **Dynamic Voice Scheduling:** During a call, `services/agent` exposes function tools (`schedule_callback`, `list_scheduled_calls`, `cancel_scheduled_call`, `end_call`) backed directly by Supabase PostgreSQL.
3. **Automated Callbacks:** The NestJS scheduler polls due schedules every 15 seconds using PostgreSQL `FOR UPDATE SKIP LOCKED` (`claim_due_schedules`), creates a `ringing` session in `call_sessions`, notifies active clients via Supabase Realtime, and dispatches Android FCM / iOS APNs VoIP pushes when configured.
4. **On-Accept Agent Dispatch:** The LiveKit AI agent is only dispatched after the user answers an incoming call, preventing unnecessary compute and API usage on missed or declined calls.

---

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Web Client | Next.js 15, Tailwind CSS, `@livekit/components-react`, LiveKit Agents UI |
| Mobile Client | Expo (React Native, TypeScript), Expo Router, `@livekit/react-native`, `react-native-callkeep`, `@react-native-firebase/messaging`, `expo-updates` |
| Backend API & Scheduler | NestJS, `@nestjs/schedule`, `livekit-server-sdk`, `firebase-admin`, Node.js HTTP/2 APNs |
| Voice AI Agent | `@livekit/agents`, `@livekit/agents-plugin-google` (Gemini Live API) |
| Database & Auth | Supabase (PostgreSQL, Auth, Row Level Security, Realtime) |
| CI/CD | GitHub Actions, EAS Update, EAS Build |

---

## Prerequisites

- Node.js 22+ and npm
- Supabase project (free tier supported)
- LiveKit Cloud project (free tier supported)
- Google AI Studio API key with Gemini Live access
- Optional (Android lock-screen calling): Firebase project (`google-services.json` and Service Account JSON)
- Optional (iOS lock-screen calling): Apple Developer Program account with APNs `.p8` key

---

## Local Setup

### 1. Apply Database Schema

Open your Supabase project SQL Editor and execute:

```text
supabase/migrations/001_init_schema.sql
```

### 2. Configure Environment Variables

Copy each `.env.example` to `.env` (or `.env.local` for `apps/web`) and populate your credentials:

- `services/api/.env` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME`. Leave `FIREBASE_*` and `APNS_*` blank to run with Supabase Realtime only.
- `services/agent/.env` — `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`.
- `apps/web/.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AGENT_NAME`.
- `apps/mobile/.env` — `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GITHUB_REPO`.

### 3. Install Dependencies

```bash
npm run install:all
```

### 4. Run Locally

Start each service in a separate terminal from the repository root:

```bash
npm run dev:api     # NestJS API & scheduler on http://localhost:3001
npm run dev:agent   # LiveKit voice agent worker
npm run dev:web     # Next.js web client on http://localhost:3000
```

---

## Android Lock-Screen Calling and APK Builds

1. Create a Firebase project and register an Android app with package name `com.kallie.app`.
2. Place the downloaded `google-services.json` at `apps/mobile/google-services.json`.
3. Generate a Firebase Service Account private key and configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` in `services/api/.env`.
4. Set `EXPO_ENABLE_ANDROID_FCM=true` and your publicly reachable API URL in `apps/mobile/.env`.
5. Build an installable Android APK using EAS:

```bash
cd apps/mobile
npx eas init
npx eas build --profile preview --platform android
```

---

## Automated Updates via GitHub Actions

- **Over-the-Air (OTA) JS/UI Updates:** Add `EXPO_TOKEN` to repository secrets (**Settings > Secrets and variables > Actions**). Every push to `main` modifying `apps/mobile/**` runs `.github/workflows/ota-update.yml` to publish an EAS Update. Installed mobile apps automatically check for, download, and prompt to apply updates on startup.
- **Native Android APK Releases:** Pushing a semantic version tag (for example, `v0.2.0`) triggers `.github/workflows/android-release.yml`. Publishing the resulting `.apk` to GitHub Releases surfaces an in-app update banner linking directly to the release download.

---

## Verification and Testing

```bash
npm run test:api        # NestJS build + unit tests (health, calls, scheduler)
npm run test:agent      # Voice agent unit tests (metadata, voice tools, end_call)
npm run test:all        # Run all automated test suites
npm run build:web       # Production Next.js build check
npm run typecheck:mobile
```

---

## Docker and AWS EC2 Deployment

Production containers are defined in `docker-compose.yml` (`api`, `agent`, `web`, and `caddy` for automatic Let's Encrypt HTTPS).

1. Point DNS `A` records for `API_DOMAIN` and `WEB_DOMAIN` to your EC2 public IP and open inbound ports `22`, `80`, and `443` in the EC2 Security Group.
2. Copy `infra/.env.prod.example` to `.env` at the server repo root (`/opt/kallie/.env`) and upload `services/api/.env`, `services/agent/.env`, and `apps/web/.env.local`.
3. Run the bootstrap and deployment script on the EC2 instance:

```bash
bash infra/deploy-ec2.sh
```

The script installs Docker and Compose if absent, pulls `main`, builds and starts all services with healthchecks, and verifies `GET /health`.

---

## License

MIT
