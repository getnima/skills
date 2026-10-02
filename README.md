<p align="center">
  <a href="https://getnima.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/nima-logo-inverse.svg">
      <img src="assets/nima-logo.svg" alt="nima" width="180">
    </picture>
  </a>
</p>

<h3 align="center">nima for coding agents</h3>

<p align="center">
  A Claude Code plugin and agent skills that make Claude Code, Codex and other coding agents use nima's knowledge graph:<br>
  who asked for what, what they said, why a decision was made, and what is true in the product today.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-the-plugin-does">Plugin</a> ·
  <a href="#skills">Skills</a> ·
  <a href="#connect-to-nima">Connect</a> ·
  <a href="https://docs.getnima.io">Docs</a>
</p>

---

## Install

**Claude Code: install the plugin.** In the repository whose product your nima workspace tracks:

```
/plugin marketplace add getnima/skills
```

Then, from a shell (inside Claude Code, choose Project scope when prompted):

```bash
claude plugin install nima@nima --scope project
```

Then run `/mcp`, pick `plugin:nima:nima`, and sign in. The plugin uses four scopes:
`knowledge:read`, `signals:read`, `documents:read` and `signals:write`.

> **Filing is on by default.** The agent may file a guarded signal into your workspace when it confirms a product
> gap, and tells you in one line. Set `NIMA_SIGNAL_MODE=ask` to approve each one, or `off` to disable filing. The
> Stop hook may also ask the agent to reconsider once per session.

Use project scope, not user scope. With user scope the plugin is active in every repository, and an agent in an
unrelated project would file that project's details into the workspace you connected. A workspace should hold one
product's evidence, so enable the plugin per repository.

**Codex and other agents: install the skill.**

```bash
npx skills add getnima/skills --agent codex
```

This installs only the read skill, `nima`, because the filing skill is marked internal and never reaches agents
that have no hooks to guard it. `INSTALL_INTERNAL_SKILLS=1` bypasses that protection: never set it for an agent
without the plugin's hooks. Codex reads `.agents/skills/` in the repository or `~/.codex/skills/` globally and
exposes it as `$nima`.

Do not install both in Claude Code: the plugin already carries the `nima` skill, and `npx skills add` would add a
duplicate.

## What the plugin does

It bundles the nima MCP server, the `nima` skill (read), the `file-signal` skill (write), a read-only
`nima-provenance` agent for three or more lookups, and hooks that run on their own:

- **Session start**: a short card tells the agent when to query nima, the filing mode, and the exact `sourceLabel`
  to use (`agent:claude-code:<repo>`).
- **Prompts**: a question that looks like product evidence or history gets a one-line nudge to ask nima first
  (5 per session). Build or plan work gets a pre-flight nudge (3 per session).
- **Filing**: when the agent confirms a concrete product gap while working, it follows `file-signal`: search first,
  dedupe, fixed template. A guard on `create_signal` blocks the call with a reason unless every check passes.
- **Stop**: if a final answer mentions a likely gap and nothing was filed, one nudge asks the agent to file it or
  reply `No signal to file`. At most once per session, never in a turn that already filed.

### What the guard enforces

- the main session is calling (not a subagent) and filing is not off
- `sourceLabel` is exactly `agent:claude-code:<repo>`, where `<repo>` comes from the `origin` remote (fallback: the
  project directory name)
- `stakeholders` is empty and `productAreas` has 1 to 3 lowercase kebab-case tags
- `content` is 80 to 1500 characters with `Gap:` and `Evidence:` lines, the evidence has a `path:line` or a commit
  sha, and there are no URLs or code fences
- no secret, token, private key or email pattern, and no probe or instruction phrase, appears in any field
- `search_signals` and `ask_knowledge_graph` both succeeded in this session within the last 30 minutes, since the
  last filing
- caps hold: 1 per turn, 3 per session, 5 per rolling 24 hours (local to the machine)
- the same content was not already filed

```
Gap: <one sentence, product terms>.
Observed: <what was attempted and what happened>.
Expected: <behavior the product would need>.
Evidence: <repo@shortsha path:line>.
```

After a filing you see one line: `Filed to nima: <id> - "<first sentence>" (agent:claude-code:<repo>)`. An audit log
is kept under the plugin data directory (`filed.jsonl`).

### Modes and opt-outs

| Control                         | Effect                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| `NIMA_SIGNAL_MODE=auto`         | Default. The guard passes silently and the agent tells you in one line.    |
| `NIMA_SIGNAL_MODE=ask`          | The guard turns every allowed filing into a permission prompt (the draft). |
| `NIMA_SIGNAL_MODE=off`          | Filing is blocked. The session card omits the filing instructions.         |
| `NIMA_GAP_NUDGE=0`              | Turns off the Stop nudge only.                                             |
| `NIMA_PLUGIN=off`               | Disables every hook.                                                       |
| `.nima-off` in the project root | Disables every hook for that repository.                                   |

Set the variables in the `env` block of your `settings.json`. With the plugin off, `create_signal` is still
blocked: an opt-out never leaves filing unguarded.

### Requirements and limits

Requires bash and Node 18 or newer; macOS and Linux (no Windows). Stated plainly:

- The search-first check proves a search ran, not that it was relevant. The dedupe judgment is still a model decision.
- The hook cannot do semantic redaction. It catches secret and PII patterns, not a customer name in prose.
- A subagent is blocked when the hook input carries an `agent_id`. That field is best effort.
- Agent-filed signals carry the `agent:claude-code:<repo>` label. Treat them as agent observations, not customer
  demand.
- Caps are per machine: two machines can each file 5 in a day.
- Hooks fail open, except the guard, which fails closed: if Node is missing or the guard errors, `create_signal`
  is blocked.

### Headless runs

OAuth needs a browser. For CI or headless agents, create a personal API key in nima (Settings, API keys) with the
scopes above and add your own server; the user definition takes precedence over the bundled one:

```bash
claude mcp add --transport http --scope user nima https://mcp.getnima.io/mcp \
  --header "Authorization: Bearer nima_…"
```

Tools then appear as `mcp__nima__*` instead of `mcp__plugin_nima_nima__*`; the plugin covers both.

## Skills

| Skill                                        | Who gets it                  | What it teaches                                                                                                                                                             |
| -------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`nima`](skills/nima/SKILL.md)               | the plugin and `npx skills`  | Asking nima's knowledge graph, signals and specs over MCP: when to query, how to phrase a question, how to read every line of a result, how to answer without overclaiming. |
| [`file-signal`](skills/file-signal/SKILL.md) | the plugin only (`internal`) | Filing a verified, deduplicated product gap as a signal. Hidden from `npx skills` because it needs the plugin's guard hook.                                                 |

Try it once connected:

> Has anyone asked for CSV export? What exactly did they say?

> Why is animation disabled on the dashboard?

> What do customers think about billing?

## Connect to nima

The server is `https://mcp.getnima.io/mcp`. Connecting starts an OAuth flow that ends on nima's consent screen.
The Claude Code plugin bundles the server; everything else connects it by hand:

```bash
# Claude Code without the plugin
claude mcp add --transport http nima https://mcp.getnima.io/mcp

# Codex
codex mcp add nima --url https://mcp.getnima.io/mcp
codex mcp login nima
```

Claude.ai and Claude Desktop: Settings → Connectors → Add custom connector → paste the URL. Full steps, API keys
and permissions: [docs.getnima.io/docs/mcp-server/overview](https://docs.getnima.io/docs/mcp-server/overview/).

## Layout

```
.claude-plugin/   marketplace.json and plugin.json (this repo is the plugin and its marketplace)
.mcp.json         the nima MCP server
skills/nima/      the read skill, shared by the plugin and `npx skills`
skills/file-signal/  the filing skill (internal: plugin only)
agents/           nima-provenance, a read-only reader
hooks/            hooks.json and run.sh (fails closed for the guard)
scripts/          nima-hook.mjs and its tests
assets/           nima wordmark and gate, used by this README
```

Develop and test:

```bash
claude plugin validate .
node --test scripts/nima-hook.test.mjs
claude --plugin-dir .      # then /reload-plugins after edits
```

Never file test signals into a real workspace. Skills follow the [Agent Skills](https://agentskills.io) format and
install with the [`skills`](https://github.com/vercel-labs/skills) CLI.

---

<p align="center">
  <a href="https://getnima.io">getnima.io</a> · <a href="https://docs.getnima.io">docs</a> · <a href="https://app.getnima.io">app</a>
</p>
