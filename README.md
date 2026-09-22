<p align="center">
  <a href="https://getnima.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/nima-logo-inverse.svg">
      <img src="assets/nima-logo.svg" alt="nima" width="180">
    </picture>
  </a>
</p>

<h3 align="center">Agent skills for nima</h3>

<p align="center">
  Teach Claude Code, Codex and other coding agents to use nima's knowledge graph:<br>
  who asked for what, what they said, why a decision was made, and what is true in the product today.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#skills">Skills</a> ·
  <a href="#connect-to-nima">Connect</a> ·
  <a href="https://docs.getnima.io">Docs</a>
</p>

---

## Install

```bash
# Claude Code
npx skills add getnima/skills --agent claude-code

# Codex
npx skills add getnima/skills --agent codex

# both, for every project on this machine
npx skills add getnima/skills --agent claude-code codex -g
```

Claude Code picks the skill up from `.claude/skills/` and exposes it as `/nima`. Codex reads
`.agents/skills/` in the repository or `~/.codex/skills/` globally and exposes it as `$nima`.
Both also load it on their own when a task matches the skill's description.

## Skills

| Skill | What it teaches |
| --- | --- |
| [`nima`](skills/nima/SKILL.md) | Asking nima's knowledge graph through the `ask_knowledge_graph` MCP tool: connecting from Claude Code and Codex, how to phrase a question, how to read every line of a result, and how to answer from it without overclaiming. |

### What the `nima` skill does

nima runs one pipeline, **Signal → Beacon → Spec → PR → Closed**, and builds a knowledge
graph from everything that passes through it: customer signals from Slack, GitHub, HubSpot,
Granola, Linear, PostHog and Sentry, pull requests and reviews, specs, commits and PM notes.
The graph holds what a codebase cannot: who asked for a feature and what they said, why a
line was written, what was decided and what was rejected.

With the skill installed, an agent knows

- **when to ask the graph**: any question about people, requests, decisions or product history, before concluding "nobody asked for this";
- **how to ask it**: by topic rather than by name, one question per call, how to follow up on an entity it did not expect;
- **how to read an answer**: entity types, why similarity is not confidence, stale summaries, fact sources, contradictions, relation evidence;
- **the gotchas**: names miss where topics hit, twin entities, truncated excerpts, internal notes that look like customer requests, nima's own ids, learned-versus-said dates, rate limits;
- **how to answer from it**: told versus inferred, cite sources the way the graph does, never invent an id or a quote.

Try it once connected:

> Has anyone asked for CSV export? What exactly did they say?

> Why is animation disabled on the dashboard?

> What do customers think about billing?

## Connect to nima

The skill assumes the agent is connected to nima's remote MCP server at
`https://mcp.getnima.io/mcp`. Connecting starts an OAuth flow that ends on nima's consent
screen; the knowledge graph needs the `knowledge:read` permission.

```bash
# Claude Code
claude mcp add --transport http nima https://mcp.getnima.io/mcp

# Codex
codex mcp add nima --url https://mcp.getnima.io/mcp
codex mcp login nima
```

Claude.ai and Claude Desktop: Settings → Connectors → Add custom connector → paste the URL.
Headless agents and CI use a personal API key as a bearer token instead. Full steps, API keys
and permissions: [docs.getnima.io/docs/mcp-server/overview](https://docs.getnima.io/docs/mcp-server/overview/).

## Layout

```
skills/
  nima/
    SKILL.md      the skill, in the Agent Skills format
assets/           nima wordmark and gate, used by this README
```

Skills follow the [Agent Skills](https://agentskills.io) format and install with the
[`skills`](https://github.com/vercel-labs/skills) CLI.

---

<p align="center">
  <a href="https://getnima.io">getnima.io</a> · <a href="https://docs.getnima.io">docs</a> · <a href="https://app.getnima.io">app</a>
</p>
