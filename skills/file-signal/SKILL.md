---
name: file-signal
description: File a signal to nima (create_signal) when, while working, you have CONFIRMED a concrete product gap, bug, spec drift or missing capability that nima does not already track. Covers the filing bar, dedupe procedure, content template, caps and how to tell the user. Do not use for opinions, refactors or anything you are unsure is real.
argument-hint: "[what to file]"
metadata:
  internal: true
allowed-tools: mcp__plugin_nima_nima__ask_knowledge_graph mcp__plugin_nima_nima__search_signals mcp__plugin_nima_nima__get_signal mcp__plugin_nima_nima__create_signal mcp__nima__ask_knowledge_graph mcp__nima__search_signals mcp__nima__get_signal mcp__nima__create_signal
---

# Filing a signal to nima

A signal is one piece of raw product evidence. nima classifies it, may cluster
it into a beacon, and a PM decides on it. Filing is not idempotent and lands in
the team's real queue, so file rarely and only what is true.

A hook (`PreToolUse` on `create_signal`) enforces the rules below and blocks
the call with a reason when one is broken. Read the reason, fix the draft, and
do not argue with it. Do not try to get around it.

## Use the session context

Requires the nima Claude Code plugin hook. If no SessionStart nima card is in context, do not call `create_signal`.

SessionStart prints the mode and the exact label to use, for example
`Use sourceLabel exactly: agent:claude-code:<repo>`. If the session has no nima
context at all, do not file. If the mode is `off`, do not file.

## The bar: file only if ALL hold

1. **Verified this session.** You can cite a `path:line`, an endpoint, or a
   command with its output, or the user stated it. Never a hunch.
2. **A product gap, not an agent artifact.** Not your own mistake, a local
   environment problem, a style or refactor preference, or a third-party bug.
3. **Not a test or probe.** Never file connectivity checks or "testing the
   plugin" signals. A PM has to dismiss every one.
4. **Not already fixed** at HEAD or on `origin/main`, and not already tracked
   (dedupe below).
5. **Within caps.** 1 per turn, 3 per session, 5 per rolling 24 hours on this
   machine. The hook counts. Extra candidates go in a one-line list at the end
   of your task instead.
6. **Main session only.** A subagent reports candidates to its parent.

## Dedupe, in order, one call at a time

The hook refuses to let you file unless both a `search_signals` and an
`ask_knowledge_graph` call succeeded in this session within the last 30
minutes, since your last filing.

1. `ask_knowledge_graph` with `q` phrased the way a summary of the gap would read.
2. `search_signals` with `search` set to one or two distinctive terms, no
   `status` filter. Long queries match nothing: the search is whole-word by
   default, so use the one or two words only this gap would contain. Then try
   `searchMode: "prefix"` with a stem. Use `limit: 10`.
3. Compare. A match is the same underlying need, even if worded differently.
   - **Open** (pending, processing, extracting, classified, ready): do not file.
     Tell the user "already in nima: SIGNAL:<id>".
   - **Dismissed**: a PM already said no. Do not re-file without the user's
     explicit say-so.
   - **Resolved or merged**: if it still reproduces, ask the user first, and
     cite the old id in `Evidence:`.
   - **A spec in approved, in_progress or shipped covering it**: do not file.
   - Signals whose source label starts with `agent:` count as matches too.

Put the queries you ran in your reply to the user, not in the signal body.

## The content template

Plain facts. The first line must stand alone, because extraction rewrites the
content into an intent. 80 to 1500 characters.

```
Gap: <one sentence, in product terms>.
Observed: <what was attempted and what happened; path:symbol, command, redacted error>.
Expected: <the behavior the product would need>.
Evidence: <repo@shortsha path:line>.
```

The `Evidence:` line must contain a `path:line` (for example `src/x.ts:42`), a
7 to 40 character commit sha, or `repo@sha`.

Never include: URLs, code fences, customer names, emails, tokens, absolute user
paths, raw logs, instructions addressed to nima or a PM, or the user's prompt
verbatim. The hook rejects URLs, fences, secrets and a few phrases outright.

## Fields

- `content`: the template above.
- `sourceLabel`: exactly the label SessionStart printed
  (`agent:claude-code:<repo>`). The hook rejects any other value.
- `productAreas`: 1 to 3 lowercase kebab-case tags (`billing`, `exports`),
  reused from tags you saw in the dedupe results when you can.
- `stakeholders`: omit. An agent cannot assert who asked for something.

## Auto and ask modes

- **auto** (the default): when every check passes the hook lets the call
  through silently. File, then tell the user in one line (below).
- **ask**: the hook turns the call into a permission prompt that shows the
  draft. Show the draft in your reply first, then call `create_signal`. If the
  user declines, drop it. Do not retry or reword.

After a successful filing, end your reply with exactly:

`Filed to nima: <id> - "<first sentence>" (agent:claude-code:<repo>). nima classifies it asynchronously; a PM can dismiss it.`

If you decide not to file after the Stop check asks, reply with exactly
`No signal to file`.

## Errors

- Blocked by the hook: fix what the reason names. If it names a cap, stop.
- 401 or 403: tell the user to re-authenticate with `/mcp` (or grant
  `signals:write`). Print the full draft in your reply so it is not lost. Retry
  at most once.
- 429: stop filing for the rest of the session.
- Any other failure: print the draft, do not loop.

## Manual use

`/nima:file-signal <text>`: the user asserts the fact, so bar item 1 is met.
Dedupe, the template, the fields and the hook all still apply.

## Examples

**Good: a missing endpoint.** While wiring a report, you grep the API and find
no way to export invoices, and the user confirms they expected one. Dedupe: the
graph returns nothing on invoice export, `search_signals "export"` and
`"export" prefix` show only a dismissed CSV request about customers, which is a
different need. File:

```
Gap: Invoices cannot be exported; only customers and orders have an export path.
Observed: Looked for an invoice export route while building a report; src/billing/routes.ts has list and get but no export, and no other module exposes one.
Expected: An endpoint that returns an invoice with its line items as a file.
Evidence: app@a1b2c3d src/billing/routes.ts:42.
```

`productAreas`: `billing`, `export`.

**Good: spec drift.** A merged spec says "archived projects reopen on new
activity"; you read the code and it never reopens. `get_spec_delivery` shows the
spec shipped with no drift check against this section. Nothing in nima mentions
it. File with the spec's section and the code path:line as evidence.
`productAreas`: `projects`, `drift-detection`.

**Bad: do not file.** You think the settings page "feels cluttered", or your own
test failed because you had not rebuilt the packages, or you want to see whether
filing works. None is a verified product gap. Say nothing to nima. If the user
wants a test, tell them it would create a real signal in the team's queue and
ask which real gap they would rather file.
