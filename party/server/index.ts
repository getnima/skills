import { createPartyApp, lanIps } from './app';
import { configFromEnv } from './config';

// One bad message or a bug in one room must not end the party for everyone.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception (still serving)', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection (still serving)', reason);
});

const config = configFromEnv(process.env);
const party = createPartyApp(config);

party
  .listen()
  .then((port) => {
    console.log(`[party] server listening on 0.0.0.0:${port}`);
    for (const ip of lanIps()) console.log(`[party]   http://${ip}:${port}${party.clientDir !== null ? '/host' : ''}`);
    if (party.clientDir !== null) console.log('[party] phone remote: /remote (password: PARTY_REMOTE_PASSWORD or the default)');
    console.log(party.clientDir !== null ? `[party] serving client from ${party.clientDir}` : '[party] no built client found (API only)');
    if (config.timing.introMs !== 7_000 || process.env.PARTY_TEST_DURATION_MS !== undefined) {
      console.log('[party] TEST timing is on (short intro / countdown / rounds)');
    }
  })
  .catch((err: unknown) => {
    console.error('[party] could not start', err);
    process.exit(1);
  });

function shutdown(): void {
  void party.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
