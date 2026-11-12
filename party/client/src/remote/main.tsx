/** The owner's phone remote: /remote. */
import '../kit/base.css';
import './remote.css';

import { render } from 'preact';

import { initMobileViewport } from '../kit/mobile';
import { App } from './app';

initMobileViewport();
const root = document.getElementById('app');
if (root !== null) render(<App />, root);
