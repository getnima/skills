/**
 * Mount the dressing room without writing Preact: for a host that is not a Preact tree, and for
 * the browser tests (tests/e2e/avatar-room*.cjs import this module through vite).
 *
 *   const room = mountDressingRoom(el, { look, name, onChange, onDone, compact });
 *   room.update({ look: fromServer });   // props are merged
 *   room.unmount();                      // reports a pending change first
 */
import { h, render } from 'preact';

import { DressingRoom } from './dressing';

import type { DressingRoomFullProps } from './dressing';

export interface MountedDressingRoom {
  update(props: Partial<DressingRoomFullProps>): void;
  unmount(): void;
}

export function mountDressingRoom(el: HTMLElement, props: DressingRoomFullProps): MountedDressingRoom {
  let current = props;
  render(h(DressingRoom, current), el);
  return {
    update(next) {
      current = { ...current, ...next };
      render(h(DressingRoom, current), el);
    },
    unmount() {
      render(null, el);
    },
  };
}
