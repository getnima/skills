import { render } from 'preact';

import '../kit/base.css';
import './host.css';
import { initMobileViewport } from '../kit/mobile';
import { App } from './app';

initMobileViewport();
const root = document.getElementById('app');
if (root !== null) render(<App />, root);
