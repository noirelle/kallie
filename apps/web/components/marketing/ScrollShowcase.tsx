'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

const HERO_TAGLINE_WORDS =
  'AN AI VOICE COMPANION THAT CALLS YOU BACK ON YOUR SCHEDULE.'.split(' ');

const INTERLUDE_WORDS = 'ALWAYS READY. ALWAYS ON TIME.'.split(' ');

const VOICE_EXAMPLES = [
  {
    id: 'callback',
    index: '01',
    label: 'CALLBACK',
    quote: '“Call me back in 2 minutes.”',
    action: 'schedule_callback(delayMinutes: 2)',
    reply: '“Got it. I will ring you in two minutes.”',
  },
  {
    id: 'reminder',
    index: '02',
    label: 'REMINDER',
    quote: '“Remind me tomorrow at 9 AM.”',
    action: 'schedule_callback(scheduledAt: "09:00")',
    reply: '“Scheduled for 9:00 AM tomorrow.”',
  },
  {
    id: 'status',
    index: '03',
    label: 'SCHEDULE',
    quote: '“What time are you calling me next?”',
    action: 'list_scheduled_calls()',
    reply: '“You have a 9:00 AM check-in tomorrow.”',
  },
  {
    id: 'hangup',
    index: '04',
    label: 'END CALL',
    quote: '“End the call for now.”',
    action: 'end_call()',
    reply: '“Talk soon. Bye for now.”',
  },
];

const PARALLAX_MARKS = [
  { top: '14%', left: '10%', size: 22, opacity: 0.06, depth: 1 },
  { top: '22%', left: '84%', size: 32, opacity: 0.1, depth: 2 },
  { top: '68%', left: '14%', size: 42, opacity: 0.14, depth: 3 },
  { top: '76%', left: '82%', size: 24, opacity: 0.07, depth: 1 },
  { top: '42%', left: '8%', size: 34, opacity: 0.09, depth: 2 },
  { top: '48%', left: '89%', size: 48, opacity: 0.12, depth: 3 },
];

const EQ_FRAMES = [
  [12, 34, 18, 44, 22, 12],
  [22, 54, 28, 62, 34, 22],
  [30, 74, 40, 82, 46, 30],
  [20, 48, 24, 58, 30, 20],
  [10, 30, 16, 38, 18, 10],
];

function ScrubWord({
  word,
  progress,
  range,
}: {
  word: string;
  progress: MotionValue<number>;
  range: [number, number];
}) {
  const opacity = useTransform(progress, range, [0.16, 1]);
  return (
    <motion.span style={{ opacity }} className="mr-[0.28em] inline-block">
      {word}
    </motion.span>
  );
}

function VoiceCommandPanel() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % VOICE_EXAMPLES.length);
    }, 4400);
    return () => clearInterval(id);
  }, []);

  const current = VOICE_EXAMPLES[activeIdx];

  return (
    <div className="w-full border border-white/12 bg-black p-6 md:p-8">
      <div className="mb-6 grid grid-cols-2 gap-px border border-white/12 bg-white/12 sm:grid-cols-4">
        {VOICE_EXAMPLES.map((item, idx) => {
          const active = idx === activeIdx;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`px-3 py-2.5 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors ${
                active
                  ? 'bg-white font-bold text-black'
                  : 'bg-black text-zinc-500 hover:bg-zinc-950 hover:text-zinc-200'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="my-6 flex h-20 items-center justify-center gap-2 border-y border-white/[0.08] py-4">
        {EQ_FRAMES.map((frames, idx) => (
          <motion.span
            key={idx}
            className="w-1.5 bg-white"
            animate={{ height: frames, opacity: [0.45, 1, 0.65, 1, 0.55, 0.45] }}
            transition={{ duration: 2.1 + idx * 0.14, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">
              You
            </p>
            <p className="mt-1 text-base font-medium text-white">{current.quote}</p>
          </div>

          <div className="border-l-2 border-white/40 pl-3 font-mono text-[11px] text-zinc-400">
            {current.action}
          </div>

          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">
              Kallie
            </p>
            <p className="mt-1 text-base text-zinc-200">{current.reply}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function LockScreenPreview() {
  return (
    <div className="mx-auto w-full max-w-xs border border-white/15 bg-black p-6">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
        <span>LOCK SCREEN</span>
        <span>09:00</span>
      </div>

      <div className="my-10 flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/kallie-logo.svg"
          alt="Kallie"
          className="mb-5 size-14 border border-white/15"
        />
        <p className="font-mono text-[10px] tracking-[0.26em] text-zinc-400 uppercase">
          INCOMING CALL
        </p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">Kallie</p>
        <p className="mt-1 text-xs text-zinc-500">Morning Check-In · Scheduled by Voice</p>
      </div>

      <div className="grid grid-cols-2 gap-px border border-white/15 bg-white/15">
        <div className="bg-black py-3 text-center font-mono text-[10px] tracking-[0.18em] text-zinc-400 uppercase">
          Decline
        </div>
        <div className="bg-white py-3 text-center font-mono text-[10px] font-bold tracking-[0.18em] text-black uppercase">
          Answer
        </div>
      </div>
    </div>
  );
}

export function ScrollShowcase() {
  const trackRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  });

  const smooth = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    mass: 0.4,
  });

  // Hero logo shrinks and docks cleanly into the top-center rail (HaloHaloGames signature motion)
  const logoScale = useTransform(smooth, [0, 0.16], [1, 0.32]);
  const logoY = useTransform(smooth, [0, 0.16], ['0vh', '-46.2vh']);
  const logoWordmarkOpacity = useTransform(smooth, [0.05, 0.13], [1, 0]);
  const topRailOpacity = useTransform(smooth, [0.14, 0.2], [0, 1]);

  // Hero tagline & scroll cue fade out as Layer 2 slides in
  const heroCopyOpacity = useTransform(smooth, [0.12, 0.2], [1, 0]);
  const scrollCueOpacity = useTransform(smooth, [0, 0.06], [1, 0]);

  // Multi-depth background glyph parallax
  const parallaxFar = useTransform(smooth, [0, 1], [0, -90]);
  const parallaxMid = useTransform(smooth, [0, 1], [0, -210]);
  const parallaxNear = useTransform(smooth, [0, 1], [0, -340]);

  // Pinned layered sheet wipes (z-10 -> z-40)
  const sheet1Y = useTransform(smooth, [0.16, 0.32], ['100vh', '0vh']);
  const sheet2Y = useTransform(smooth, [0.4, 0.56], ['100vh', '0vh']);
  const interludeY = useTransform(smooth, [0.62, 0.74], ['100vh', '0vh']);
  const downloadY = useTransform(smooth, [0.84, 0.96], ['100vh', '0vh']);

  return (
    <div ref={trackRef} className="relative h-[520vh] bg-black text-white">
      {/* Hairline top scroll progress bar */}
      <motion.div
        style={{ scaleX: smooth }}
        className="fixed top-0 right-0 left-0 z-50 h-[2px] origin-left bg-white"
      />

      {/* Minimalist docked top bar (appears as hero logo docks) */}
      <motion.header
        style={{ opacity: topRailOpacity }}
        className="fixed top-0 right-0 left-0 z-40 flex h-16 items-center justify-between bg-black/95 px-6 backdrop-blur-sm md:px-12"
      >
        <span className="font-mono text-[10px] tracking-[0.28em] text-zinc-500 uppercase">
          KALLIE / ANDROID
        </span>
        <a
          href="https://github.com/noirelle/kallie/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="border border-white/25 bg-black px-4 py-2 font-mono text-[10px] font-semibold tracking-[0.2em] text-white uppercase transition-colors hover:bg-white hover:text-black"
        >
          Get APK
        </a>
      </motion.header>

      {/* Sticky full-viewport stage */}
      <div className="sticky top-0 h-dvh w-full overflow-hidden bg-black">
        {/* Background multi-depth monochrome K parallax layer */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {PARALLAX_MARKS.map((m, idx) => {
            const y = m.depth === 1 ? parallaxFar : m.depth === 2 ? parallaxMid : parallaxNear;
            return (
              <motion.img
                key={idx}
                src="/kallie-logo.svg"
                alt=""
                style={{
                  top: m.top,
                  left: m.left,
                  width: m.size,
                  height: m.size,
                  opacity: m.opacity,
                  y,
                }}
                className="absolute select-none"
              />
            );
          })}
        </div>

        {/* Docked / Hero Brand Mark (remains pinned top-center above incoming sheets) */}
        <motion.div
          style={{ scale: logoScale, y: logoY }}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
        >
          <div className="relative flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/kallie-logo.svg"
              alt="Kallie"
              className="size-24 border border-white/15 md:size-28"
            />
            <motion.span
              style={{ opacity: logoWordmarkOpacity }}
              className="absolute top-full mt-4 font-mono text-sm font-bold tracking-[0.38em] whitespace-nowrap text-white uppercase"
            >
              Kallie
            </motion.span>
          </div>
        </motion.div>

        {/* LAYER 1: HERO */}
        <section className="absolute inset-0 z-0 flex flex-col items-center justify-center px-6 text-center">
          <motion.div
            style={{ opacity: heroCopyOpacity }}
            className="mt-52 max-w-2xl md:mt-56"
          >
            <p className="font-mono text-xs leading-7 tracking-[0.22em] text-white uppercase md:text-sm">
              {HERO_TAGLINE_WORDS.map((word, idx) => {
                const start = 0.01 + idx * 0.008;
                const end = Math.min(0.14, start + 0.03);
                return (
                  <ScrubWord
                    key={`${word}-${idx}`}
                    word={word}
                    progress={smooth}
                    range={[start, end]}
                  />
                );
              })}
            </p>
          </motion.div>

          <motion.div
            style={{ opacity: scrollCueOpacity }}
            className="absolute bottom-8 flex flex-col items-center gap-3"
          >
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase">
              Scroll
            </span>
            <motion.span
              animate={{ scaleY: [0.4, 1, 0.4], opacity: [0.3, 0.9, 0.3] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="block h-10 w-px origin-top bg-white/50"
            />
          </motion.div>
        </section>

        {/* LAYER 2: VOICE SCHEDULING SHEET */}
        <motion.section
          style={{ y: sheet1Y }}
          className="absolute inset-x-0 top-16 bottom-0 z-10 flex items-center overflow-y-auto border-t border-white/15 bg-[#070707] px-6 py-8 md:px-12"
        >
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <p className="font-mono text-[10px] tracking-[0.28em] text-zinc-500 uppercase">
                01 / Dynamic Voice
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Just say when.
              </h2>
              <p className="mt-5 text-sm leading-7 text-zinc-400 md:text-base">
                No forms. No calendar taps. Tell Kallie when to call you back or what to remind
                you about—she understands natural speech and schedules it immediately.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6 font-mono text-[10px] tracking-[0.18em] text-zinc-400 uppercase">
                <div>
                  <span className="block text-white">Sub-Second</span>
                  Gemini Live Audio
                </div>
                <div>
                  <span className="block text-white">Hands-Free</span>
                  Voice Hangup & Cancel
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <VoiceCommandPanel />
            </div>
          </div>
        </motion.section>

        {/* LAYER 3: LOCK-SCREEN CALLING SHEET */}
        <motion.section
          style={{ y: sheet2Y }}
          className="absolute inset-x-0 top-16 bottom-0 z-20 flex items-center overflow-y-auto border-t border-white/15 bg-[#0C0C0C] px-6 py-8 md:px-12"
        >
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="order-2 lg:order-1 lg:col-span-6">
              <LockScreenPreview />
            </div>

            <div className="order-1 lg:order-2 lg:col-span-6">
              <p className="font-mono text-[10px] tracking-[0.28em] text-zinc-500 uppercase">
                02 / Native Android
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Rings even when locked.
              </h2>
              <p className="mt-5 text-sm leading-7 text-zinc-400 md:text-base">
                When your scheduled moment arrives, Kallie wakes your Android device through
                high-priority push and native call UI. Answer and talk immediately over LiveKit
                WebRTC.
              </p>
              <div className="mt-8 flex items-center gap-6 border-t border-white/10 pt-6 font-mono text-[10px] tracking-[0.18em] text-zinc-400 uppercase">
                <span>LiveKit WebRTC</span>
                <span className="text-zinc-700">/</span>
                <span>Android FCM</span>
                <span className="text-zinc-700">/</span>
                <span>OTA Updates</span>
              </div>
            </div>
          </div>
        </motion.section>

        {/* LAYER 4: TYPOGRAPHIC INTERLUDE (WORD-BY-WORD SCRUB) */}
        <motion.section
          style={{ y: interludeY }}
          className="absolute inset-x-0 top-16 bottom-0 z-30 flex flex-col items-center justify-center border-t border-white/15 bg-black px-6 text-center"
        >
          <h2 className="max-w-4xl text-4xl font-semibold tracking-tight text-white uppercase sm:text-6xl md:text-7xl">
            {INTERLUDE_WORDS.map((word, idx) => {
              const start = 0.72 + idx * 0.02;
              const end = Math.min(0.84, start + 0.035);
              return (
                <ScrubWord
                  key={`${word}-${idx}`}
                  word={word}
                  progress={smooth}
                  range={[start, end]}
                />
              );
            })}
          </h2>
          <p className="mt-6 font-mono text-[11px] tracking-[0.26em] text-zinc-500 uppercase">
            Built for mobile · Auto-updated via GitHub
          </p>
        </motion.section>

        {/* LAYER 5: FINAL DOWNLOAD SHEET */}
        <motion.section
          style={{ y: downloadY }}
          className="absolute inset-x-0 top-16 bottom-0 z-40 flex flex-col justify-between overflow-y-auto border-t border-white/15 bg-[#050505] px-6 py-8 md:px-12 md:py-10"
        >
          <div className="mx-auto my-auto grid w-full max-w-4xl grid-cols-1 items-center gap-10 md:grid-cols-12">
            <div className="md:col-span-7">
              <p className="font-mono text-[10px] tracking-[0.28em] text-zinc-500 uppercase">
                03 / Android App
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Download Kallie.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-zinc-400">
                Install the signed Android APK directly from GitHub Releases. Future improvements
                deliver automatically over the air.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="https://github.com/noirelle/kallie/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 bg-white px-7 py-3.5 font-mono text-xs font-bold tracking-[0.18em] text-black uppercase transition-colors hover:bg-zinc-200"
                >
                  <span>Download APK</span>
                  <span aria-hidden>-&gt;</span>
                </a>

                <a
                  href="https://github.com/noirelle/kallie"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center border border-white/20 px-6 py-3.5 font-mono text-xs font-semibold tracking-[0.18em] text-zinc-200 uppercase transition-colors hover:border-white/50 hover:text-white"
                >
                  GitHub
                </a>
              </div>
            </div>

            <div className="flex flex-col items-center md:col-span-5 md:items-end">
              <a
                href="https://github.com/noirelle/kallie/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/20 bg-white p-3 transition-opacity hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/android-download-qr.svg"
                  alt="Scan to download Kallie Android APK"
                  className="size-36"
                />
              </a>
              <p className="mt-3 font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">
                Scan on Android
              </p>
            </div>
          </div>

          <footer className="mx-auto flex w-full max-w-4xl items-center justify-between border-t border-white/10 pt-5 font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">
            <span>© 2026 Kallie</span>
            <div className="flex items-center gap-6">
              <a
                href="https://github.com/noirelle/kallie/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                Releases
              </a>
              <a
                href="https://github.com/noirelle/kallie"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                Source
              </a>
            </div>
          </footer>
        </motion.section>
      </div>
    </div>
  );
}
