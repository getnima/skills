import { render } from 'preact';

import '../kit/base.css';
import './look.css';
import './host.css';
import { preloadAvatarAssets } from '../avatar';
import { initMobileViewport } from '../kit/mobile';
import { App } from './app';

initMobileViewport();
// every accessory picture once (about 2 MB): from then on a guest's doll is drawn from the cache
void preloadAvatarAssets();
const root = document.getElementById('app');
if (root !== null) render(<App />, root);
