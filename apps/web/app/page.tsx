import Link from 'next/link';
import { CapabilitiesSection } from '@/components/marketing/CapabilitiesSection';
import { DownloadSection } from '@/components/marketing/DownloadSection';
import { HeroSection } from '@/components/marketing/HeroSection';
import { HowItWorksSection } from '@/components/marketing/HowItWorksSection';
import { MarketingNav } from '@/components/marketing/MarketingNav';

export default function LandingPage() {
  return (
    <div className="min-h-svh bg-black text-white selection:bg-white selection:text-black">
      <MarketingNav />

      <main>
        <HeroSection />
        <CapabilitiesSection />
        <HowItWorksSection />
        <DownloadSection />
      </main>

      <footer className="border-t border-white/[0.08] px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/kallie-logo.svg"
              alt="Kallie"
              className="size-5 rounded border border-white/15"
            />
            <span className="font-mono text-xs font-bold tracking-[0.2em] text-zinc-300 uppercase">
              Kallie
            </span>
          </div>

          <div className="flex items-center gap-6 font-mono text-[11px] tracking-wider text-zinc-500 uppercase">
            <Link href="/call" className="transition-colors hover:text-white">
              Web Voice
            </Link>
            <a
              href="https://github.com/noirelle/kallie/releases/latest"
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
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
