'use client';

import { motion } from 'motion/react';

interface CapabilityCard {
  tag: string;
  title: string;
  description: string;
  span?: string;
}

const CAPABILITIES: CapabilityCard[] = [
  {
    tag: '01 · VOICE SCHEDULING',
    title: 'Zero forms. Speak to schedule.',
    description:
      'Say “Call me tomorrow at 9 AM” or “Remind me in 10 minutes.” Kallie parses relative delays, exact dates, and daily or weekly recurrence directly from natural conversation.',
    span: 'md:col-span-2',
  },
  {
    tag: '02 · LOCK-SCREEN CALLING',
    title: 'Rings like a real call.',
    description:
      'High-priority Android FCM and native CallKeep wake your locked device so you can answer straight into LiveKit audio.',
  },
  {
    tag: '03 · NATIVE AUDIO AI',
    title: 'Sub-second voice turns.',
    description:
      'Built on Gemini Live native audio and pre-warmed LiveKit workers for fluid English and Taglish conversations without awkward pauses.',
  },
  {
    tag: '04 · FULL VOICE CONTROL',
    title: 'Ask, cancel, or hang up by voice.',
    description:
      'Check upcoming callback times, cancel reminders mid-sentence, or simply say goodbye and Kallie closes the room cleanly and syncs your transcript.',
    span: 'md:col-span-2',
  },
  {
    tag: '05 · ALWAYS CURRENT',
    title: 'Automatic over-the-air updates.',
    description:
      'Install the Android APK once. UI and workflow upgrades ship automatically via EAS Update and GitHub Releases.',
    span: 'md:col-span-3',
  },
];

export function CapabilitiesSection() {
  return (
    <section id="capabilities" className="mx-auto max-w-6xl px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.55 }}
        className="mb-14 max-w-2xl"
      >
        <p className="font-mono text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
          Capabilities
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-5xl">
          Designed to feel like a real call, not a calendar app.
        </h2>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CAPABILITIES.map((item, idx) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.5, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={`group relative overflow-hidden rounded-3xl border border-white/[0.09] bg-[#060606] p-7 transition-colors hover:border-white/25 ${item.span ?? ''}`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <p className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">
              {item.tag}
            </p>
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">{item.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
