import { render } from 'preact';

import '../kit/base.css';
import './look.css';
import './host.css';
import { preloadAvatarAssets } from '../avatar';
import { initMobileViewport } from '../kit/mobile';
import { App } from './app';
import { preloadIntroArt } from './show/art';

initMobileViewport();
// the games' key art, when it exists: no picture pops in late on the first intro
preloadIntroArt();
// every accessory picture once (about 2 MB): from then on a guest's doll is drawn from the cache
void preloadAvatarAssets();
const root = document.getElementById('app');
if (root !== null) render(<App />, root);
