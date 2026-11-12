// Local stand-in for https://plotzel.netlify.app (which is unreachable from the test machine).
// Serves client/public/plotzel-bridge/mock.html (it contains the README bridge snippet verbatim)
// under paths that each simulate one way the real site can misbehave inside our iframe.
//
//   node tests/e2e/fixtures/plotzel-standin.cjs [port]      (default 5233)
//
//   /ok            mock with the bridge snippet
//   /nobridge      mock without the snippet (players self-report)
//   /xfo           X-Frame-Options: DENY
//   /csp           Content-Security-Policy: frame-ancestors 'none'
//   /hang          headers sent, the body never finishes
//   /slow?ms=8000  the whole page arrives after ms (slow 3G)
//   /tall          content much taller than the frame (scrolls inside the iframe)
//   /input         a native <input> the player types into (opens the phone keyboard)
//   /evil          calls alert(), tries to navigate top, opens a popup
//   /snippet       the README snippet only, printed as text (to diff against the README)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.PZ_STANDIN_PORT || 5233);
const MOCK = path.join(__dirname, '..', '..', '..', 'client', 'public', 'plotzel-bridge', 'mock.html');

function mock() {
  return fs.readFileSync(MOCK, 'utf8');
}

/** Insert html right before </body> of the mock. */
function withExtra(extra) {
  return mock().replace('</body>', `${extra}\n</body>`);
}

const TALL = `<div id="tall" style="flex:none;height:1600px;width:100%;background:linear-gradient(#fffbe9,#d8f5d0);display:flex;align-items:flex-end;justify-content:center;font-size:22px">
  <button id="bottom-btn" type="button">כפתור בתחתית</button></div>`;
const INPUT = `<input id="native" type="text" dir="rtl" placeholder="הקלידו מילה" style="font-size:20px;padding:8px;width:220px" />`;
const EVIL = `<script>
  window.__evil = { alert: 'none', top: 'none', popup: 'none' };
  try { var r = alert('alert from the site'); window.__evil.alert = 'returned'; } catch (e) { window.__evil.alert = 'threw ' + e.name; }
  try { window.top.location.href = 'https://example.invalid/hijacked'; window.__evil.top = 'tried'; } catch (e) { window.__evil.top = 'threw ' + e.name; }
  try { var w = window.open('https://example.invalid/popup', '_blank'); window.__evil.popup = w ? 'opened' : 'blocked'; } catch (e) { window.__evil.popup = 'threw ' + e.name; }
  setTimeout(function () { try { window.top.location = 'https://example.invalid/later'; } catch (e) {} }, 1500);
  document.getElementById('log').textContent = JSON.stringify(window.__evil);
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (body, headers = {}) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(body);
  };
  switch (url.pathname) {
    case '/':
    case '/ok':
      return send(mock());
    case '/nobridge':
      // same page, the snippet is skipped (mock.html honours ?bridge=0 too)
      return send(mock().replace("q.get('bridge') !== '0'", 'false'));
    case '/xfo':
      return send(mock(), { 'x-frame-options': 'DENY' });
    case '/csp':
      return send(mock(), { 'content-security-policy': "frame-ancestors 'none'" });
    case '/hang':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.write('<!doctype html><html><body><p>loading forever');
      return; // never end
    case '/slow': {
      const ms = Number(url.searchParams.get('ms') || 8000);
      setTimeout(() => send(mock()), ms);
      return;
    }
    case '/tall':
      return send(withExtra(TALL));
    case '/input':
      return send(withExtra(INPUT));
    case '/evil':
      return send(withExtra(EVIL));
    case '/snippet': {
      const m = /<script type="text\/plain" id="snippet">([\s\S]*?)<\/script>/.exec(mock());
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(m ? m[1] : '');
    }
    default:
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[plotzel-standin] http://127.0.0.1:${PORT}`));
module.exports = server;
