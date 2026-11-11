/**
 * The TV show. Scenes fill their parent, animate themselves from props and
 * never touch the network. See types.ts for the props.
 *
 * Also exported for the host shell:
 * - setShowCalm / isShowCalm / onShowCalmChange: the global "calm" switch
 *   that turns the funny layer down.
 */
import './show.css';

export { PlayingScene } from './playing';
export { ResultsScene } from './results';
export { FinalScene } from './final';
export { StandingsPanel } from './standings';
export { isShowCalm, onShowCalmChange, setShowCalm } from './settings';
