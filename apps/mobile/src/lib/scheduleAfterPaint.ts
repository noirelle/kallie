/**
 * Defers non-critical boot work strictly past initial frame paint using
 * standard `requestAnimationFrame` + optional delay (RN 0.88+ compatible,
 * zero deprecated InteractionManager usage).
 */
export function scheduleAfterPaint(
  callback: () => void,
  delayMs = 0,
): () => void {
  let cancelled = false;
  let raf1: number | null = null;
  let raf2: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (cancelled) return;
    if (delayMs > 0) {
      timer = setTimeout(() => {
        if (!cancelled) {
          callback();
        }
      }, delayMs);
    } else {
      callback();
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrame(run);
    });
  } else {
    timer = setTimeout(run, Math.max(16, delayMs));
  }

  return () => {
    cancelled = true;
    if (raf1 !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(raf1);
    }
    if (raf2 !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(raf2);
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
