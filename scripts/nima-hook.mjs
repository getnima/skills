// nima Claude Code plugin hooks. One entry, five subcommands:
//   session-start | prompt | guard | record | stop
// Hook JSON arrives on stdin. No network, no dependencies, node: imports only.
// Every subcommand fails open (exit 0, no output) except `guard`, which fails
// closed (exit 2): a crash must never let an unchecked create_signal through.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// ---------------------------------------------------------------- constants

const CAP_TURN = 1;
const CAP_SESSION = 3;
const CAP_24H = 5;
const RESERVATION_TTL_MS = 120_000; // a declined prompt fires no PostToolUse
const SEARCH_FRESH_MS = 30 * 60_000;
const STATE_MAX_AGE_MS = 14 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
const NUDGE_CAP_A = 5;
const NUDGE_CAP_B = 3;
const MIN_PROMPT_LEN = 12;
const MIN_STOP_MESSAGE_LEN = 200;
const CONTENT_MIN = 80;
const CONTENT_MAX = 1500;
const LABEL_PREFIX = 'agent:claude-code:';
const ESCAPE_PHRASE = 'No signal to file';
const FILED_MARKER = 'Filed to nima';
const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 3000;

const SECRET_PATTERNS = [
  /nima_[A-Za-z0-9]{16,}/,
  /Bearer\s+\S{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_/,
  /xox[abprs]-/,
  /sk-[A-Za-z0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\./,
  /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /ya29\./,
  // Placeholders such as [redacted], <redacted>, REDACTED or *** are not secrets.
  /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*(?!\[?<?(?:redacted|removed|omitted|x{3,}|\*{3,}))\S{6,}/i,
  // Emails, but not ssh remotes like git@github.com.
  /(?<![A-Za-z0-9._%+-])(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
];
const PROBE_PATTERN =
  /connectivity check|test signal|testing the plugin|ignore (all |the )?(this|previous|above|prior)|disregard|system prompt|you are now|mark (this )?as (critical|urgent)|dismiss this|please (create|file|prioriti)|\bas an AI\b/i;
const URL_PATTERN = /https?:\/\//i;
const EVIDENCE_PATH_LINE =
  /[\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|c|h|swift|md|json|ya?ml|sql|sh|css|html|vue|svelte):\d+/;
const EVIDENCE_SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const NUDGE_A_PATTERN =
  /did anyone|has anyone|nobody asked|who asked|\bcustomers?\b|why did we|why was|\brejected\b|\bdemand\b|\brequested\b|\bfeedback\b|\broadmap\b/i;
const NUDGE_B_PATTERN =
  /\b(implement|build|add|design|plan|propose)\b.{0,40}\b(feature|endpoint|flow|integration|tool)\b/i;
const NUDGE_A_TEXT =
  '[nima] Possible product-evidence or history question. Per the nima skill, call ask_knowledge_graph (and search_signals for exact words) before answering from the repo alone. Say "the graph is silent" only after asking. Skip for pure code questions.';
const NUDGE_B_TEXT =
  '[nima] Pre-flight: one ask_knowledge_graph plus one search_signals on the area name for open signals and prior decisions before designing.';

const GAP_LEXICON =
  /doesn't exist|does not exist|not implemented|no (such )?(endpoint|tool|route|api|way to)|not supported|unsupported|missing (capability|endpoint|tool|field|test|support)|had to work around|workaround|spec drift|drifts? from|known limitation|no test (covers|for)/i;
const NOT_OUR_GAP =
  /third-party|upstream|library|vendor|npm|pypi|your (code|repo)/i;
const STOP_REASON =
  'nima check before stopping: your answer mentions a possible product gap. If it is concrete and verified (you saw it in the tree or reproduced it), follow the nima file-signal skill now (search first, one signal, then tell the user in one line). If it is an opinion, already fixed, already in nima, or a third-party issue, reply with exactly: No signal to file. Do not redo your answer.';

// ---------------------------------------------------------------- small utils

const isObject = (v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readStdinJson() {
  try {
    const raw = readFileSync(0, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Thrown (not process.exit) so a held lock is released on the way out. */
class GuardDenied extends Error {}

function deny(reason) {
  throw new GuardDenied(reason);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function hashContent(content) {
  return sha256(content.replace(/\s+/g, ' ').trim().toLowerCase());
}

function sanitizeSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)
    ? id
    : 'nosession';
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------- config

function getMode() {
  const raw = (process.env.NIMA_SIGNAL_MODE ?? '').trim().toLowerCase();
  return raw === 'ask' || raw === 'off' ? raw : 'auto';
}

function getDataDir() {
  const candidates = [
    process.env.CLAUDE_PLUGIN_DATA,
    join(homedir(), '.claude', 'plugins', 'data', 'nima-nima'),
    join(tmpdir(), 'nima-plugin'),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      mkdirSync(join(dir, 'state'), { recursive: true });
      mkdirSync(join(dir, 'reservations'), { recursive: true });
      return dir;
    } catch {
      // try the next location
    }
  }
  throw new Error('no writable data directory');
}

// ---------------------------------------------------------------- repo label

function runGit(cwd, args) {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 1000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return res.status === 0 ? res.stdout.trim() : '';
}

function sanitizeRepoName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .slice(0, 60);
}

/** Repo name from origin's URL, else the project dir's basename, else "unknown". */
function getRepoName(input) {
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const remote = runGit(cwd, ['remote', 'get-url', 'origin']);
  const segment =
    remote
      .split(/[/:\\]/)
      .filter(Boolean)
      .pop() ?? '';
  const fromRemote = sanitizeRepoName(segment.replace(/\.git$/i, ''));
  if (fromRemote) return fromRemote;
  const dir = process.env.CLAUDE_PROJECT_DIR || cwd;
  return sanitizeRepoName(basename(dir)) || 'unknown';
}

function getSourceLabel(input) {
  return `${LABEL_PREFIX}${getRepoName(input)}`;
}

// ---------------------------------------------------------------- state

function statePath(dataDir, sessionId) {
  return join(dataDir, 'state', `${sessionId}.json`);
}

function newState() {
  return {
    turn: 0,
    prompts: 0,
    nudgesA: 0,
    nudgesB: 0,
    searches: [],
    filed: 0,
    filedTurn: -1,
    hashes: [],
    stopNudged: false,
    nudgedTurn: -1,
  };
}

function loadState(dataDir, sessionId) {
  return { ...newState(), ...readJson(statePath(dataDir, sessionId), {}) };
}

function saveState(dataDir, sessionId, state) {
  writeJsonAtomic(statePath(dataDir, sessionId), state);
}

/** One global lock (mkdir is atomic) around every read-modify-write of state. */
function withLock(dataDir, fn) {
  const lockDir = join(dataDir, 'lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // lock vanished between the two calls
      }
      if (Date.now() > deadline) throw new Error('state lock timeout');
      sleepMs(20);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- reservations and audit log

function listReservations(dataDir) {
  const dir = join(dataDir, 'reservations');
  const now = Date.now();
  const live = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const path = join(dir, file);
    const res = readJson(path, null);
    if (!res || now - res.t > RESERVATION_TTL_MS) {
      rmSync(path, { force: true });
      continue;
    }
    live.push({ ...res, path });
  }
  return live;
}

function readFiledLog(dataDir) {
  try {
    return readFileSync(join(dataDir, 'filed.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- hook input helpers

const toolIs = (input, name) =>
  typeof input.tool_name === 'string' && input.tool_name.endsWith(name);

function responseText(input) {
  const r = input.tool_response;
  if (typeof r === 'string') return r;
  try {
    return JSON.stringify(r ?? '');
  } catch {
    return '';
  }
}

function isErrorResponse(input) {
  const r = input.tool_response;
  return (
    input.is_error === true ||
    input.tool_response_is_error === true ||
    (isObject(r) && (r.isError === true || r.is_error === true))
  );
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (isObject(value))
    Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

const firstSentence = (text) =>
  (text.match(/[^.!?\n]+[.!?]?/)?.[0] ?? '').trim();

// ---------------------------------------------------------------- session-start

function sessionStart(input) {
  const dataDir = getDataDir();
  pruneOldState(dataDir);
  const mode = getMode();
  const repo = getRepoName(input);
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sha = runGit(cwd, ['rev-parse', '--short', 'HEAD']);

  const parts = [
    'nima plugin active. Before claiming that customers did or did not ask for something, before writing a spec, plan or PRD that asserts demand, and before removing or redesigning a feature with product history, query nima (skill: nima). Do not use it for questions grep answers. If nima tools are missing or unauthenticated, tell the user once to run /mcp and authenticate the nima server; never loop on it.',
  ];
  if (mode !== 'off') {
    parts.push(
      `File-signal mode: ${mode}. When you confirm a concrete product gap, bug or missing capability while working, follow skill file-signal (search first, at most 3 per session, main session only). Never file test or probe signals. Use sourceLabel exactly: ${LABEL_PREFIX}${repo}`,
    );
  }
  parts.push(`repo=${repo}${sha ? ` sha=${sha}` : ''}`);
  process.stdout.write(`${parts.join('\n')}\n`);
}

function pruneOldState(dataDir) {
  const dir = join(dataDir, 'state');
  const now = Date.now();
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    try {
      if (now - statSync(path).mtimeMs > STATE_MAX_AGE_MS)
        rmSync(path, { force: true });
    } catch {
      // raced with another prune
    }
  }
}

// ---------------------------------------------------------------- prompt

function prompt(input) {
  const dataDir = getDataDir();
  const sessionId = sanitizeSessionId(input.session_id);
  const text = typeof input.prompt === 'string' ? input.prompt.trim() : '';

  const nudge = withLock(dataDir, () => {
    const state = loadState(dataDir, sessionId);
    state.turn += 1;
    state.prompts += 1;
    let line = null;
    const eligible = text.length >= MIN_PROMPT_LEN && !text.startsWith('/');
    if (eligible && NUDGE_A_PATTERN.test(text) && state.nudgesA < NUDGE_CAP_A) {
      state.nudgesA += 1;
      line = NUDGE_A_TEXT;
    } else if (
      eligible &&
      NUDGE_B_PATTERN.test(text) &&
      state.nudgesB < NUDGE_CAP_B
    ) {
      state.nudgesB += 1;
      line = NUDGE_B_TEXT;
    }
    saveState(dataDir, sessionId, state);
    return line;
  });

  if (nudge) {
    emit({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: nudge,
      },
    });
  }
}

// ---------------------------------------------------------------- guard

/** Returns a denial reason for the first failed content rule, else null. */
function checkContentRules(toolInput, expectedLabel) {
  const content =
    typeof toolInput.content === 'string' ? toolInput.content : '';

  if (toolInput.sourceLabel !== expectedLabel) {
    return `sourceLabel must be exactly "${expectedLabel}".`;
  }
  const stakeholders = toolInput.stakeholders;
  if (
    stakeholders !== undefined &&
    stakeholders !== null &&
    !(Array.isArray(stakeholders) && stakeholders.length === 0)
  ) {
    return 'stakeholders must be omitted: an agent cannot assert who asked.';
  }
  const areas = toolInput.productAreas;
  if (
    !Array.isArray(areas) ||
    areas.length < 1 ||
    areas.length > 3 ||
    !areas.every((a) => typeof a === 'string' && KEBAB.test(a))
  ) {
    return 'productAreas must be 1 to 3 lowercase kebab-case tags.';
  }
  if (content.length < CONTENT_MIN || content.length > CONTENT_MAX) {
    return `content must be ${CONTENT_MIN} to ${CONTENT_MAX} characters.`;
  }
  const lines = content.split('\n').map((l) => l.trim());
  if (!lines.some((l) => l.startsWith('Gap:')))
    return 'content needs a line starting "Gap:".';
  const evidence = lines.find((l) => l.startsWith('Evidence:'));
  if (!evidence) return 'content needs a line starting "Evidence:".';
  if (!EVIDENCE_PATH_LINE.test(evidence) && !EVIDENCE_SHA.test(evidence)) {
    return 'the Evidence: line needs a path:line (src/x.ts:42), a commit sha, or repo@sha.';
  }
  if (URL_PATTERN.test(content)) return 'content must not contain URLs.';
  if (content.includes('```')) return 'content must not contain code fences.';

  const strings = collectStrings(toolInput);
  if (strings.some((s) => SECRET_PATTERNS.some((p) => p.test(s)))) {
    return 'content looks like it contains a secret or an email address; redact it.';
  }
  if (strings.some((s) => PROBE_PATTERN.test(s))) {
    return 'content looks like a test or instruction to nima; file only confirmed product gaps in plain facts.';
  }
  return null;
}

function hasFreshSearches(state) {
  const cutoff = Date.now() - SEARCH_FRESH_MS;
  const fresh = (tool) =>
    state.searches.some((s) => s.tool === tool && s.t >= cutoff);
  return fresh('search_signals') && fresh('ask_knowledge_graph');
}

function guard(input) {
  if (getMode() === 'off') deny('signal filing is off (NIMA_SIGNAL_MODE=off)');
  if (input.agent_id) {
    deny(
      'only the main session files signals; report this candidate to the parent agent.',
    );
  }
  const toolInput = isObject(input.tool_input) ? input.tool_input : {};
  const contentReason = checkContentRules(toolInput, getSourceLabel(input));
  if (contentReason) deny(contentReason);

  const dataDir = getDataDir();
  const sessionId = sanitizeSessionId(input.session_id);
  const hash = hashContent(toolInput.content);

  const reservedPath = withLock(dataDir, () => {
    const state = loadState(dataDir, sessionId);
    const live = listReservations(dataDir);
    const mine = live.filter((r) => r.sid === sessionId);
    const log = readFiledLog(dataDir);

    if (!hasFreshSearches(state)) {
      deny(
        'search first: call search_signals and ask_knowledge_graph (one at a time) within 30 minutes before filing, and again after each filing.',
      );
    }
    const turnCount =
      (state.filedTurn === state.turn ? 1 : 0) +
      mine.filter((r) => r.turn === state.turn).length;
    if (turnCount >= CAP_TURN)
      deny(
        'at most 1 signal per user turn; mention other candidates in your summary.',
      );
    if (state.filed + mine.length >= CAP_SESSION) {
      deny(
        `at most ${CAP_SESSION} signals per session; mention other candidates in your summary.`,
      );
    }
    const last24h =
      log.filter((e) => Date.now() - Date.parse(e.ts) < DAY_MS).length +
      live.length;
    if (last24h >= CAP_24H)
      deny(`at most ${CAP_24H} signals per 24 hours on this machine.`);
    if (
      state.hashes.includes(hash) ||
      log.some((e) => e.hash === hash) ||
      live.some((r) => r.hash === hash)
    ) {
      deny('an identical signal was already filed.');
    }
    if (process.env.NIMA_PLUGIN_DRYRUN === '1') deny('dry run, nothing filed.');

    const path = join(
      dataDir,
      'reservations',
      `${sessionId}.${Date.now()}.${randomBytes(4).toString('hex')}.json`,
    );
    writeJsonAtomic(path, {
      sid: sessionId,
      t: Date.now(),
      turn: state.turn,
      hash,
    });
    return path;
  });

  if (getMode() === 'ask') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `nima: file this signal? ${toolInput.content.slice(0, 160)}`,
      },
    });
  }
  return reservedPath;
}

// ---------------------------------------------------------------- record

function record(input) {
  const dataDir = getDataDir();
  const sessionId = sanitizeSessionId(input.session_id);
  const failed = isErrorResponse(input);

  if (toolIs(input, 'search_signals') || toolIs(input, 'ask_knowledge_graph')) {
    if (failed) return;
    const tool = toolIs(input, 'search_signals')
      ? 'search_signals'
      : 'ask_knowledge_graph';
    withLock(dataDir, () => {
      const state = loadState(dataDir, sessionId);
      state.searches.push({ t: Date.now(), tool });
      state.searches = state.searches.slice(-20);
      saveState(dataDir, sessionId, state);
    });
    return;
  }
  if (!toolIs(input, 'create_signal')) return;

  const toolInput = isObject(input.tool_input) ? input.tool_input : {};
  const content =
    typeof toolInput.content === 'string' ? toolInput.content : '';
  const label =
    typeof toolInput.sourceLabel === 'string'
      ? toolInput.sourceLabel
      : getSourceLabel(input);
  const hash = hashContent(content);

  const result = withLock(dataDir, () => {
    const state = loadState(dataDir, sessionId);
    const mine = listReservations(dataDir).filter((r) => r.sid === sessionId);
    const claimed = mine.find((r) => r.hash === hash) ?? mine[0];
    if (claimed) rmSync(claimed.path, { force: true });
    if (failed) return null; // reservation released, nothing counted

    state.filed += 1;
    state.filedTurn = state.turn;
    state.hashes.push(hash);
    state.searches = [];
    saveState(dataDir, sessionId, state);

    const signalId =
      responseText(input).match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      )?.[0] ?? null;
    appendFileSync(
      join(dataDir, 'filed.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), sessionId, signalId, sourceLabel: label, repo: label.replace(LABEL_PREFIX, ''), hash, first200: content.slice(0, 200) })}\n`,
    );
    return { n: state.filed };
  });
  if (!result) return;

  emit({
    systemMessage: `nima: filed signal ${result.n} of ${CAP_SESSION} this session (${label}): ${content.slice(0, 100).replace(/\s+/g, ' ')}. Dismiss it in nima if it is wrong.`,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `End your final answer with the "${FILED_MARKER}" line from the file-signal skill.`,
    },
  });
}

// ---------------------------------------------------------------- stop

function hasGapSentence(message) {
  return message
    .split(/(?<=[.!?])\s+|\n+/)
    .some(
      (sentence) => GAP_LEXICON.test(sentence) && !NOT_OUR_GAP.test(sentence),
    );
}

function stop(input) {
  if (process.env.NIMA_GAP_NUDGE === '0' || getMode() === 'off') return;
  const message =
    typeof input.last_assistant_message === 'string'
      ? input.last_assistant_message
      : '';
  if (message.length < MIN_STOP_MESSAGE_LEN) return;
  if (message.includes(ESCAPE_PHRASE) || message.includes(FILED_MARKER)) return;
  if (!hasGapSentence(message)) return;

  const dataDir = getDataDir();
  const sessionId = sanitizeSessionId(input.session_id);
  const shouldNudge = withLock(dataDir, () => {
    const state = loadState(dataDir, sessionId);
    // turn 0 means UserPromptSubmit never ran: unknown turn counts as already nudged.
    if (state.turn === 0 || state.stopNudged || state.nudgedTurn === state.turn)
      return false;
    if (state.filedTurn === state.turn || state.filed >= CAP_SESSION)
      return false;
    if (listReservations(dataDir).some((r) => r.sid === sessionId))
      return false;
    state.stopNudged = true;
    state.nudgedTurn = state.turn;
    saveState(dataDir, sessionId, state);
    return true;
  });
  if (shouldNudge) emit({ decision: 'block', reason: STOP_REASON });
}

// ---------------------------------------------------------------- main

const HANDLERS = { 'session-start': sessionStart, prompt, guard, record, stop };

function main() {
  const name = process.argv[2];
  const handler = HANDLERS[name];
  if (!handler) process.exit(0);
  try {
    handler(readStdinJson());
  } catch (err) {
    if (err instanceof GuardDenied) {
      process.stderr.write(`nima: ${err.message}\n`);
      process.exit(2);
    }
    if (name === 'guard') {
      process.stderr.write(
        `nima: guard error, create_signal blocked (${err?.message ?? err}).\n`,
      );
      process.exit(2);
    }
  }
}

main();
