<div align="center">
  <img src="./docs/assets/kallie-icon.png" alt="Kallie" width="84" />
  <h1>Kallie</h1>
  <p><strong>100% Serverless, Local-First AI Companion for Android — No Accounts, No Cloud Backend, ~12.3 MB Release APK.</strong></p>
  <p>
    <a href="https://kallie.nozorin.com"><img src="https://img.shields.io/badge/Website-kallie.nozorin.com-000000?style=for-the-badge" alt="Website" /></a>
    <a href="https://github.com/noirelle/kallie/releases/latest"><img src="https://img.shields.io/badge/Android_APK-Latest_Release-111111?style=for-the-badge" alt="Android APK" /></a>
    <a href="https://github.com/noirelle/kallie/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/noirelle/kallie/ci.yml?branch=main&style=for-the-badge&label=CI&color=111111" alt="CI Status" /></a>
  </p>
</div>

---

## Overview

Kallie is a standalone, local-first AI companion for Android. Install the APK, open it with zero sign-up, connect your preferred AI provider API key (stored strictly in Android Keystore), and immediately chat or talk in real time.

- **Zero Backend / \$0 Server Cost:** No EC2, no LiveKit server, no Supabase, no Firebase.
- **Direct Real-Time Voice:** Streams bidirectional PCM16 audio with native Android hardware `AcousticEchoCanceler` directly from your phone to **Google Gemini Live** or **OpenAI Realtime** over WebSocket.
- **Multi-Provider AI Chat & Tools:** Native SSE streaming and tool calling for **Google Gemini**, **OpenAI**, **Anthropic Claude**, and **Custom OpenAI-Compatible** endpoints (Ollama, OpenRouter, LM Studio, DeepSeek, Groq).
- **Local-First Storage & Hybrid Memory:** Conversations, reminders, settings, and long-term memories live on-device in SQLite (`kallie.db`, FTS5 + L2-normalized Float32 vector search) with portable JSON export/restore.
- **Offline Local Alarms:** Voice-created reminders schedule native Android `AlarmManager` alerts that work even offline.

---

## Architecture

```text
kallie/
├── apps/
│   ├── web/       # Pure static Next.js landing & APK download site (output: 'export', $0 static hosting)
│   └── mobile/    # Expo React Native Android client (~12.3 MB release APK, SQLite, Android Keystore,
│                  # custom Kotlin PCM+AEC direct audio & AlarmManager plugins)
└── .github/
    └── workflows/ # CI typecheck/export, EAS OTA updates, Android APK GitHub Releases
```

---

## Local Development

```bash
npm run install:all

# Static landing page
npm run dev:web
npm run build:web

# Android mobile client
npm run mobile:doctor
npm run typecheck:mobile
npm run mobile:release-local   # Builds optimized ~12.3 MB arm64-v8a release APK
```

---

## License

MIT
