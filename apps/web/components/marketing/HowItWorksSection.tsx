'use client';

import { motion } from 'motion/react';

const STEPS = [
  {
    step: '01',
    title: 'Speak naturally',
    detail:
      'Tap Start Call and tell Kallie what you need—whether it is a quick 2-minute callback or a daily morning check-in.',
  },
  {
    step: '02',
    title: 'Lock your phone',
    detail:
      'Kallie commits your reminder atomically to PostgreSQL and tracks the exact timestamp in your local timezone.',
  },
  {
    step: '03',
    title: 'Answer anywhere',
    detail:
      'When the moment arrives, your phone rings automatically. Tap Answer and Kallie opens the conversation with your reminder.',
  },
];

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="border-y border-white/[0.07] bg-[#030303] px-6 py-24"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.55 }}
          className="mb-14 max-w-xl"
        >
          <p className="font-mono text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Three steps from voice prompt to incoming call.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((item, idx) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              className="rounded-3xl border border-white/[0.08] bg-black p-7"
            >
              <span className="inline-block font-mono text-xs font-bold tracking-[0.2em] text-zinc-500">
                {item.step}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2.5 text-sm leading-6 text-zinc-400">{item.detail}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
