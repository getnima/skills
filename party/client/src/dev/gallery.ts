/** /dev.html?kit=1 : every placeholder painter and every sound of the kit, for eyes and ears. */
import { FACE_EXPRESSIONS, bombPainter, crownPainter, facePainter, paintDrawable, starPainter } from '../kit/assets';
import { sfx } from '../kit/audio';
import { hasTrackFile, playTrack, stopTrack } from '../kit/music';
import { PARTY_COLORS } from '../kit/theme';

import type { Painter } from '../kit/assets';

function h(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderGallery(app: HTMLElement): void {
  const page = h('div', 'dv-index');
  const title = h('h1', 'dv-title');
  title.innerHTML = '🎨 ערכת <b>הפלייסהולדרים</b>';
  const scroll = h('div', 'dv-gallery kit-scroll');

  const art = h('div', 'dv-art');
  const pics: Array<{ name: string; painter: Painter }> = FACE_EXPRESSIONS.map((e, i) => ({
    name: e,
    painter: facePainter(e, PARTY_COLORS[i % PARTY_COLORS.length]),
  }));
  pics.push({ name: 'bomb', painter: bombPainter }, { name: 'crown', painter: crownPainter }, { name: 'star', painter: starPainter() });
  for (const pic of pics) {
    const cell = h('div', 'dv-art-cell');
    const img = document.createElement('img');
    img.src = paintDrawable(pic.name, pic.painter, 96).url;
    img.width = 76;
    img.height = 76;
    img.alt = pic.name;
    cell.append(img, h('div', 'dv-art-name', pic.name));
    art.append(cell);
  }

  const sounds = h('div', 'dv-sounds');
  const button = (label: string, act: string, fn: () => void): void => {
    const b = h('button', 'dv-sound', label);
    b.dataset.act = act;
    b.addEventListener('click', fn);
    sounds.append(b);
  };
  button(hasTrackFile('victory') ? '🏆 שיר ניצחון (קובץ)' : '🏆 שיר ניצחון (סינתי)', 'victory', () => playTrack('victory', { loop: true }));
  button('🎺 תרועה', 'fanfare-track', () => playTrack('fanfare'));
  button('⏹ עצור', 'stop', () => stopTrack());
  const names = Object.keys(sfx) as Array<keyof typeof sfx>;
  for (const name of names) button(name, `sfx-${name}`, () => sfx[name]());
  for (let v = 0; v < 4; v++) button(`fart ${v}`, `fart-${v}`, () => sfx.fart(v, 0.8 + v * 0.15));

  scroll.append(art, sounds);
  page.append(title, scroll);
  app.replaceChildren(page);
}
