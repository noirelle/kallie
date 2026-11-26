'use client';

import Link from 'next/link';
import { motion } from 'motion/react';

export function DownloadSection() {
  return (
    <section id="download" className="mx-auto max-w-6xl px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl border border-white/[0.12] bg-[#060606] p-8 md:p-12"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-12">
          <div className="md:col-span-8">
            <p className="font-mono text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
              Get Kallie
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-5xl">
              Install on Android or launch right in your browser.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400 md:text-base">
              Download the latest signed Android APK directly from GitHub Releases. Over-the-air
              updates keep your app current automatically whenever improvements ship.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="https://github.com/noirelle/kallie/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-white px-6 py-3 font-mono text-xs font-bold tracking-[0.14em] text-black uppercase transition-colors hover:bg-zinc-200"
              >
                Download Latest APK
              </a>
              <Link
                href="/call"
                className="rounded-full border border-white/20 px-6 py-3 font-mono text-xs font-bold tracking-[0.14em] text-white uppercase transition-colors hover:border-white/45"
              >
                Open Web Voice
              </Link>
              <a
                href="https://github.com/noirelle/kallie"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-3 font-mono text-xs tracking-[0.14em] text-zinc-400 uppercase transition-colors hover:text-white"
              >
                GitHub Repo
              </a>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center md:col-span-4">
            <a
              href="https://github.com/noirelle/kallie/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-white/15 bg-white p-3.5 transition-transform duration-200 hover:scale-[1.03]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/android-download-qr.svg"
                alt="Scan to download Kallie Android APK"
                className="size-36"
              />
            </a>
            <p className="mt-3 font-mono text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
              Scan with Android Camera
            </p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
