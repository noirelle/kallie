'use client';

import Link from 'next/link';
import { motion } from 'motion/react';

export function MarketingNav() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 left-0 z-50 w-full border-b border-white/[0.06] bg-black/75 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/kallie-logo.svg"
            alt="Kallie"
            className="size-7 rounded-md border border-white/15"
          />
          <span className="font-mono text-xs font-bold tracking-[0.22em] text-white uppercase">
            Kallie
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-xs font-medium text-zinc-400 md:flex">
          <a href="#capabilities" className="transition-colors hover:text-white">
            Capabilities
          </a>
          <a href="#how-it-works" className="transition-colors hover:text-white">
            How it works
          </a>
          <a href="#download" className="transition-colors hover:text-white">
            Download
          </a>
        </nav>

        <div className="flex items-center gap-2.5">
          <Link
            href="/call"
            className="rounded-full border border-white/15 px-4 py-2 font-mono text-[11px] font-semibold tracking-wider text-zinc-200 uppercase transition-colors hover:border-white/35 hover:text-white"
          >
            Web Voice
          </Link>
          <a
            href="https://github.com/noirelle/kallie/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-white px-4 py-2 font-mono text-[11px] font-bold tracking-wider text-black uppercase transition-colors hover:bg-zinc-200"
          >
            Download APK
          </a>
        </div>
      </div>
    </motion.header>
  );
}
