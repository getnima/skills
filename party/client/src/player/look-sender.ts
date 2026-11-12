/**
 * Sends the guest's look to the server while they dress: the LATEST look, at most once per
 * interval, and never a second one while the first is still on its way. Pure (the socket,
 * the clock and the timers come from outside), unit tested in tests/unit/look-sender.test.ts.
 *
 *   tap tap tap tap ......  tap
 *   send(1)    send(4)      send(5)        (interval between the starts of two sends)
 */

export interface LookSenderDeps {
  /**
   * Send `look` now. Call `done(true)` when the server answered (it took the look or refused
   * it: either way this look is settled), `done(false)` when no answer came (it is sent again).
   */
  send(look: string, done: (settled: boolean) => void): void;
  /** A look can be sent right now (the socket is up and this phone is in the room). */
  ready(): boolean;
  /** Minimum time between the starts of two sends. */
  readonly intervalMs: number;
  /** Wait before sending again after an unanswered send. */
  readonly retryMs: number;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** A look is waiting for the server / everything is settled (remembered across a reload). */
  onPending?(pending: boolean): void;
}

export interface LookSender {
  /** The look changed. */
  set(look: string): void;
  /** Send what is waiting now, without waiting for the interval (the dressing room closed, the link is back). */
  flush(): void;
  /** A look waits to be sent or answered. */
  pending(): boolean;
  /** Forget what is waiting (this phone left the room). */
  reset(): void;
}

export function createLookSender(deps: LookSenderDeps): LookSender {
  /** The newest look the server has not confirmed yet. */
  let want: string | null = null;
  /** A send is on its way (its number, so a late answer to an abandoned send is ignored). */
  let flight = 0;
  let flightSeq = 0;
  let lastSendAt = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  /** Skip the interval for the next send (flush() while a send was on its way). */
  let urgent = false;
  let wasPending = false;

  function notify(): void {
    const now = want !== null;
    if (now === wasPending) return;
    wasPending = now;
    deps.onPending?.(now);
  }

  function clearTimer(): void {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  }

  function sendNow(): void {
    clearTimer();
    if (want === null || flight !== 0 || !deps.ready()) return;
    const look = want;
    const seq = ++flightSeq;
    flight = seq;
    urgent = false;
    lastSendAt = deps.now();
    deps.send(look, (settled) => {
      if (flight !== seq) return;
      flight = 0;
      if (settled && want === look) want = null;
      notify();
      if (want === null) return;
      // a newer look came meanwhile, or nobody answered: again, after the interval / the retry wait
      if (settled) schedule();
      else if (timer === null) timer = deps.setTimeout(sendNow, deps.retryMs);
    });
  }

  function schedule(): void {
    if (want === null || flight !== 0 || timer !== null) return;
    const wait = urgent ? 0 : lastSendAt + deps.intervalMs - deps.now();
    if (wait <= 0) sendNow();
    else timer = deps.setTimeout(sendNow, wait);
  }

  return {
    set(look: string): void {
      want = look;
      notify();
      schedule();
    },
    flush(): void {
      if (want === null) return;
      if (flight !== 0) {
        urgent = true;
        return;
      }
      sendNow();
    },
    pending: (): boolean => want !== null,
    reset(): void {
      clearTimer();
      want = null;
      flight = 0;
      urgent = false;
      notify();
    },
  };
}
