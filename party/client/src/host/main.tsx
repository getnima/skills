import { render } from 'preact';

import '../kit/base.css';
import './look.css';
import './host.css';
import { initMobileViewport } from '../kit/mobile';
import { App } from './app';
import { startTvPreload } from './boot-preload';

initMobileViewport();
// Everything the TV shows starts loading here, in the background (the key art, the hosts, every
// accessory picture, the clips, the cutscenes, the fonts): no picture pops in late on the first
// intro and a guest's doll is drawn from the cache. Nothing below waits for it.
startTvPreload();
const root = document.getElementById('app');
if (root !== null) render(<App />, root);
