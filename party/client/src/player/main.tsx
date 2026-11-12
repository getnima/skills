/** Phone entry: what every guest sees, from the QR scan to the final podium. */
import '../kit/base.css';
import './show.css';
import './player.css';

import { render } from 'preact';

import { initMobileViewport } from '../kit/mobile';
import { App } from './app';
import { createController } from './controller';
import { keepFullscreen, watchOrientation } from './device';

initMobileViewport();
watchOrientation();
keepFullscreen();
// The browser's own bars take the show's cobalt (index.html still names the older colour).
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#10238c');
const root = document.getElementById('app');
if (root !== null) render(<App ctl={createController()} />, root);
