'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface VoiceDemoItem {
  id: string;
  label: string;
  userQuote: string;
  toolName: string;
  toolOutput: string;
  kallieReply: string;
}

const VOICE_DEMOS: VoiceDemoItem[] = [
  {
    id: 'quick',
    label: 'Quick Callback',
    userQuote: '“Call me back in 2 minutes so I do not forget to step out.”',
    toolName: 'schedule_callback',
    toolOutput: 'Active · Rings in 2 min · Asia/Manila',
    kallieReply: '“Got it. I will ring you in two minutes sharp.”',
  },
  {
    id: 'morning',
    label: 'Morning Reminder',
    userQuote: '“Call me tomorrow at 9 AM and remind me to review my slides.”',
    toolName: 'schedule_callback',
    toolOutput: 'Active · Tomorrow 9:00 AM · Review slides',
    kallieReply: '“Locked in for 9 AM tomorrow. Rest well tonight.”',
  },
  {
    id: 'check',
    label: 'Check Schedule',
    userQuote: '“What time are you calling me next?”',
    toolName: 'list_scheduled_calls',
    toolOutput: '2 active callbacks found in Supabase',
    kallieReply: '“You have a water reminder at 8 PM and a 9 AM morning call.”',
  },
  {
    id: 'hangup',
    label: 'Voice Hangup',
    userQuote: '“Thanks Kallie, end the call for now.”',
    toolName: 'end_call',
    toolOutput: 'Transcript synced · LiveKit room closed',
    kallieReply: '“Talk soon. Bye for now.”',
  },
];

const BAR_HEIGHTS = [
  [18, 42, 24, 54, 28, 18],
  [28, 64, 34, 72, 40, 28],
  [36, 86, 48, 92, 52, 36],
  [24, 58, 30, 68, 36, 24],
  [16, 38, 22, 46, 24, 16],
];

export function VoiceCommandShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % VOICE_DEMOS.length);
    }, 4800);
    return () => clearInterval(timer);
  }, []);

  const current = VOICE_DEMOS[activeIndex];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto mt-14 w-full max-w-3xl"
    >
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.1] bg-[#060606] p-6 shadow-[0_0_80px_rgba(255,255,255,0.04)] md:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        {/* Interactive command selector */}
        <div className="mb-7 flex flex-wrap items-center justify-center gap-2">
          {VOICE_DEMOS.map((item, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] tracking-wider uppercase transition-all ${
                  active
                    ? 'bg-white font-bold text-black'
                    : 'border border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/25 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Animated LiveKit-style 5-bar monochrome equalizer */}
        <div className="my-6 flex h-24 items-center justify-center gap-2.5">
          {BAR_HEIGHTS.map((frames, idx) => (
            <motion.span
              key={idx}
              className="w-2 rounded-full bg-white"
              animate={{
                height: frames,
                opacity: [0.55, 1, 0.7, 1, 0.65, 0.55],
              }}
              transition={{
                duration: 2.2 + idx * 0.14,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>

        {/* Live transcript & tool execution preview */}
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="space-y-4 text-left"
          >
            <div className="rounded-2xl border border-white/[0.07] bg-black/80 px-4 py-3.5">
              <p className="font-mono text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
                You
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-100 md:text-base">
                {current.userQuote}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 font-mono text-[11px]">
              <span className="text-white">
                fn <span className="text-zinc-300">{current.toolName}()</span>
              </span>
              <span className="text-zinc-400">{current.toolOutput}</span>
            </div>

            <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] px-4 py-3.5">
              <p className="font-mono text-[10px] tracking-[0.18em] text-zinc-400 uppercase">
                Kallie
              </p>
              <p className="mt-1 text-sm font-medium text-white md:text-base">
                {current.kallieReply}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
