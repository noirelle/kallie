'use client';

import { Button } from '@/components/ui/button';
import type { CallSessionRow } from '@/lib/kallieClient';

interface IncomingCallbackOverlayProps {
  call: CallSessionRow | null;
  accepting: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallbackOverlay({
  call,
  accepting,
  onAccept,
  onDecline,
}: IncomingCallbackOverlayProps) {
  if (!call) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-md">
      <div className="border-border bg-card w-full max-w-sm space-y-5 rounded-2xl border p-7 text-center shadow-2xl">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
          <span className="size-3 animate-ping rounded-full bg-emerald-400" />
        </div>

        <div className="space-y-1.5">
          <p className="font-mono text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
            Kallie is calling
          </p>
          <h2 className="text-foreground text-lg font-semibold">{call.title}</h2>
          <p className="text-muted-foreground line-clamp-3 text-xs leading-relaxed">
            {call.ai_prompt}
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <Button
            type="button"
            variant="destructive"
            size="lg"
            onClick={onDecline}
            disabled={accepting}
            className="flex-1 rounded-full font-mono text-xs font-bold tracking-wider uppercase"
          >
            Decline
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={onAccept}
            disabled={accepting}
            className="flex-1 rounded-full bg-emerald-600 font-mono text-xs font-bold tracking-wider text-white uppercase hover:bg-emerald-500"
          >
            {accepting ? 'Joining...' : 'Answer'}
          </Button>
        </div>
      </div>
    </div>
  );
}
