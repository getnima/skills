/** Phone entry: what every guest sees, from the QR scan to the final podium. */
import '../kit/base.css';
import './player.css';

import { render } from 'preact';

import { initMobileViewport } from '../kit/mobile';
import { App } from './app';
import { createController } from './controller';

initMobileViewport();
const root = document.getElementById('app');
if (root !== null) render(<App ctl={createController()} />, root);
