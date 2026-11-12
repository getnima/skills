/**
 * The contract between the dressing-room UI (client/src/avatar/dressing.tsx, built by a teammate)
 * and whoever mounts it (the phone's waiting screen, the lab at /avatar-lab.html?view=room).
 *
 * dressing.tsx must export a Preact component named `DressingRoom` (a default export also works):
 *   export function DressingRoom(props: DressingRoomProps): JSX.Element
 */
import type { AvatarLook } from '../../../shared/avatar';

export interface DressingRoomProps {
  /** The look to show. The room is controlled: it draws this and reports changes. */
  look: AvatarLook;
  /** Called with a new, valid look on every change (item on / off, shake, plate). */
  onChange: (look: AvatarLook) => void;
  /** Called when the guest presses the "done" button, if the room has one. */
  onDone?: (look: AvatarLook) => void;
  /** The guest's name, for the speech box or a title. */
  name?: string;
}
