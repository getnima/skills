/**
 * How the show's scenes talk to the hosts' narrator (../narrator.tsx), which lives above every
 * scene on the TV page: a scene cues a moment at the right beat of its own timeline, and tells the
 * narrator where on its screen the hosts may stand. Pages with no narrator (the show demo by
 * default) simply have no listener: `isNarratorOn()` is false and the scenes keep their own
 * commentator lines. Module state, no DOM.
 */
import type { HostId, NarrationCue } from './narration';

/** Where on the screen the hosts stand (narrator.css has one block per slot). */
export type NarrationSlot = 'lobby' | 'top' | 'side' | 'aside' | 'ceremony' | 'final-left' | 'final-top';

/** A cue as a scene sends it: the narrator stamps the time. */
export type SceneCue = Omit<NarrationCue, 'at'>;

type CueListener = (cue: SceneCue) => void;
type Listener = () => void;

let mounted = 0;
const cueListeners = new Set<CueListener>();
const slotListeners = new Set<Listener>();
const speakListeners = new Set<Listener>();
const slots = new Map<'results' | 'final', NarrationSlot>();
let speaking: HostId | null = null;
/** performance.now() when the hosts last stopped talking (0: never talked). */
let quietSince = 0;

/** True while a narrator is on the page: scenes leave their big moments to it. */
export function isNarratorOn(): boolean {
  return mounted > 0;
}

/** The narrator registers itself (returns the unregister). */
export function registerNarrator(onCue: CueListener): () => void {
  mounted++;
  cueListeners.add(onCue);
  return () => {
    mounted = Math.max(0, mounted - 1);
    cueListeners.delete(onCue);
  };
}

/** A scene cues a moment. False when no narrator listens (the scene may say its own line instead). */
export function cueNarration(cue: SceneCue): boolean {
  if (cueListeners.size === 0) return false;
  for (const fn of cueListeners) fn(cue);
  return true;
}

/** A scene says where the hosts may stand on its current screen. */
export function setNarrationSlot(scene: 'results' | 'final', slot: NarrationSlot): void {
  if (slots.get(scene) === slot) return;
  slots.set(scene, slot);
  for (const fn of slotListeners) fn();
}

export function narrationSlot(scene: 'results' | 'final'): NarrationSlot | null {
  return slots.get(scene) ?? null;
}

export function onNarrationSlot(fn: Listener): () => void {
  slotListeners.add(fn);
  return () => {
    slotListeners.delete(fn);
  };
}

/** The narrator says which host is on screen (the lobby's waiting dolls step aside for them). */
export function setNarratorSpeaking(who: HostId | null): void {
  if (speaking === who) return;
  if (who === null) quietSince = performance.now();
  speaking = who;
  for (const fn of speakListeners) fn();
}

export function narratorSpeaking(): HostId | null {
  return speaking;
}

/** How long the hosts have been quiet at `now` (performance.now()); 0 while one of them talks. */
export function narratorQuietMs(now: number): number {
  return speaking !== null ? 0 : now - quietSince;
}

export function onNarratorSpeaking(fn: Listener): () => void {
  speakListeners.add(fn);
  return () => {
    speakListeners.delete(fn);
  };
}
