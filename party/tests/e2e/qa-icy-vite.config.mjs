// QA dev server for the icy / flappy scripts: the project config with HMR off, so
// edits by other engineers in the shared tree do not reload pages in the middle
// of a 75 s scripted round. Pages pick up changes on their next load.
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
import base from '../../vite.config.ts';

export default { ...base, server: { ...base.server, hmr: false } };
