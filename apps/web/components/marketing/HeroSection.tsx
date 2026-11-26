'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { VoiceCommandShowcase } from './VoiceCommandShowcase';

export function HeroSection() {
  return (
    <section className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 pt-28 pb-20 text-center">
      {/* Subtle Google-meets-X ambient radial glow & precision grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_0%,rgba(255,255,255,0.09),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_20%,#000_40%,transparent_100%)]"
      />

      <div className="relative z-10 mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-4 py-1.5 font-mono text-[11px] tracking-[0.18em] text-zinc-300 uppercase"
        >
          <span className="size-1.5 rounded-full bg-white" />
          LiveKit WebRTC · Gemini Live Voice
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          className="bg-gradient-to-b from-white via-white to-zinc-500 bg-clip-text text-5xl font-semibold tracking-tight text-transparent sm:text-6xl md:text-7xl"
        >
          Just tell her when to call.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-6 max-w-xl text-base leading-7 text-zinc-400 md:text-lg"
        >
          Kallie is a voice-first AI companion that schedules reminders, calls you back
          automatically—even when your screen is locked—and talks with sub-second clarity.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3.5"
        >
          <a
            href="https://github.com/noirelle/kallie/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-white px-7 py-3.5 font-mono text-xs font-bold tracking-[0.14em] text-black uppercase transition-transform duration-200 hover:scale-[1.02] hover:bg-zinc-200"
          >
            Download for Android
          </a>
          <Link
            href="/call"
            className="rounded-full border border-white/20 bg-white/[0.03] px-7 py-3.5 font-mono text-xs font-bold tracking-[0.14em] text-white uppercase transition-all duration-200 hover:border-white/45 hover:bg-white/[0.07]"
          >
            Try Live in Browser
          </Link>
        </motion.div>
      </div>

      <VoiceCommandShowcase />
    </section>
  );
}
