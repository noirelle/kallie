import { Button } from '@/components/ui/button';
import type { CallScheduleRow } from '@/lib/kallieClient';

function WelcomeImage() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/kallie-logo.svg"
      alt="Kallie"
      className="mb-4 size-16 rounded-2xl border border-white/10"
    />
  );
}

interface WelcomeViewProps {
  startButtonText: string;
  isStarting?: boolean;
  onStartCall: () => void;
  upcomingReminders?: CallScheduleRow[];
}

export const WelcomeView = ({
  startButtonText,
  isStarting = false,
  onStartCall,
  upcomingReminders = [],
  ref,
}: React.ComponentProps<'div'> & WelcomeViewProps) => {
  return (
    <div ref={ref}>
      <section className="bg-background flex flex-col items-center justify-center px-6 text-center">
        <WelcomeImage />

        <p className="text-foreground max-w-prose pt-1 leading-6 font-medium">
          Talk live with Kallie
        </p>

        <Button
          size="lg"
          onClick={onStartCall}
          disabled={isStarting}
          className="mt-6 w-64 rounded-full font-mono text-xs font-bold tracking-wider uppercase"
        >
          {isStarting ? 'Starting...' : startButtonText}
        </Button>

        {upcomingReminders.length > 0 && (
          <div className="mt-8 w-full max-w-xs space-y-1.5">
            <p className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
              Upcoming from Kallie
            </p>
            {upcomingReminders.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="border-border/70 bg-card/60 flex items-center justify-between gap-3 rounded-full border px-3.5 py-1.5 text-left text-xs"
              >
                <span className="text-foreground truncate font-medium">{item.title}</span>
                <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                  {item.next_run_at
                    ? new Date(item.next_run_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="fixed bottom-5 left-0 flex w-full items-center justify-center px-6">
        <p className="text-muted-foreground max-w-prose pt-1 text-center text-xs leading-5 font-normal text-pretty">
          Just ask by voice — &ldquo;Call me back in 2 minutes&rdquo; or &ldquo;Remind me tomorrow
          at 9 AM&rdquo;.
        </p>
      </div>
    </div>
  );
};
