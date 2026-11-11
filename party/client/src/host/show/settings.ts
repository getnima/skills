/**
 * One global switch for the whole funny layer: "calm" mode. Calm keeps the
 * race, the reveals and the songs, and turns the noise down: no sticker
 * fly-bys, no screen flashes or zoom punches, far fewer commentator lines and
 * a fraction of the confetti. Persisted per browser (the TV laptop).
 */
const KEY = 'party.show.calm';
type Listener = (calm: boolean) => void;

let calm = readStored();
const listeners = new Set<Listener>();

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function isShowCalm(): boolean {
  return calm;
}

export function setShowCalm(next: boolean): void {
  if (next === calm) return;
  calm = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // private mode: keep it in memory only
  }
  for (const fn of listeners) fn(calm);
}

export function onShowCalmChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
