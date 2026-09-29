# Gortex vs nima

_Researched 2026-09-29. Gortex facts come from a clone of [zzet/gortex](https://github.com/zzet/gortex) at commit `70509f1` (merge of PR #816). nima facts come from nima's own MCP server: `ask_knowledge_graph`, `search_code` over `getnima/nima`, `getnima/landing` and `getnima/docs`, and the live tool schemas._

## TL;DR

Gortex is a **local, free, very deep code graph for one developer's agent**. nima is a **hosted
organizational memory for a product team**, which connects customer signals and decisions
to specs, PRs and code.

- **Gortex's question:** "what does this code do, and what breaks if I change it?"
- **nima's question:** "who asked for this, why, what did we decide, and did the PR ship what the spec said?"

They overlap only on the code-intelligence layer (`search_code` and `blast_radius`). On that
layer Gortex is ahead today. On everything above code, Gortex has nothing comparable.

**Positioning:** gortex is complementary to nima, not a replacement. Use gortex for code context. Use nima for why and who, and for tracking spec → PR.

## At a glance

| | **Gortex** | **nima** |
| --- | --- | --- |
| Deployment | Single Go binary with a local daemon; SQLite store in `~/.gortex` | Hosted SaaS; remote MCP at `mcp.getnima.io` with OAuth or API keys |
| Unit of use | One developer's machine; N repos per machine | One org workspace shared by the team |
| Price / license | Free, Apache-2.0 | Commercial SaaS |
| Traction | ~1.8k ⭐, 166 forks, 816+ PRs since 2026-04; 5 active contributors | Pre-seed; design partners |
| Data sources | Code, git history, GitHub PRs (via `GH_TOKEN`), ADR/spec files you declare in the repo | Slack, GitHub, HubSpot, Granola, Linear, PostHog, Sentry, PR reviews, specs, commits, PM notes |
| Core object | Symbol and edge graph (functions, calls, routes, contracts) | Entity/fact/relation graph (feature, user_need, customer, decision…) plus the Signal → Beacon → Spec → PR pipeline |
| MCP surface | ~197 tools in code; default "compact" facade of 21 tools; 18 resources, 3 prompts | ~25 focused tools (knowledge graph, signals, beacons, specs, code search, blast radius, data model, operations) |
| Agents supported | 19–20 agents auto-configured by `gortex install` | Any MCP client: Claude Code, Codex, Claude.ai/Desktop connector; also the `npx skills` package |

## Code intelligence (where they overlap)

| Capability | **Gortex** | **nima** |
| --- | --- | --- |
| Parsing | Tree-sitter for 257 grammars (~31 with bespoke extractors; the rest regex or signature-only); LSP/SCIP enrichment for ~17 languages | Tree-sitter extractors (TS/JS, Python, C-family, Rust, Solidity, …) in `apps/api/src/code-intel` |
| Call graph | Call edges in many languages, each with a provenance tier (`min_tier`) | **Call edges for TS/JS only**; other languages are import-level (stated in the `blast_radius` tool schema) |
| Blast radius | Reach index precomputed to depth 3; impact p95 ≈ 0.76 ms; tiered d1/d2/d3; composite 0–100 score | Import walk to depth 1–4, covering tests, and **the spec documents that govern the code** |
| Search | Local FTS5/BM25 plus GloVe-50d vectors with adaptive fusion; no LLM; optional MiniLM/OpenAI | Hosted query understanding, then keyword + vector + symbol + graph channels, then an **LLM rerank**; per-file summaries; exact/semantic/none match verdict |
| Data model | ORM→table edges (GORM, SQLAlchemy, Django, ActiveRecord, JPA, TypeORM, Ecto); SQL parsed by regex; **no Prisma/Drizzle models** | `get_data_model`: Prisma, Drizzle, TypeORM, Sequelize, MikroORM, Mongoose, SQLAlchemy, SQLModel, Django, Peewee, Tortoise, GORM, ent, Bun and SQL DDL, with file:line |
| Cross-repo contracts | HTTP / gRPC / GraphQL / topics / WebSocket / env / OpenAPI / Temporal provider↔consumer matching | Not a feature |
| Editing | `edit_symbol`, `rename_symbol`, `batch_edit`, `preview_edit` / `simulate_chain` (speculative edits), live editor overlays | Not a feature; nima's hosted operations run coding agents in VMs instead |
| Freshness | Live fsnotify; ~200 ms incremental restart | Synced from GitHub; answers reflect the indexed commit (`lastCommitSha` is exposed) |
| Privacy | 100% local; telemetry off | Code is indexed in nima's cloud |

## Above the code (nima only)

| Capability | **Gortex** | **nima** |
| --- | --- | --- |
| Customer feedback / signals | ✗ | ✓ `create_signal`, `search_signals`; classified and de-duplicated |
| Prioritization | ✗ (only PR risk ranking) | ✓ Beacons: ranked clusters of signals with an evidence count |
| Specs / PRDs | ✗ (it can index ADR/spec *files* you declare) | ✓ Specs grounded in signals and code; lifecycle draft → shipped |
| Spec ↔ PR drift | ✗ | ✓ `get_spec_delivery`: a per-PR, per-section aligned/drifted/not_addressed verdict |
| "Why does this exist?" | `why`: a one-hop walk over regex-mined ADRs, RFC-2119 lines and agent-written memories | `ask_knowledge_graph`: sourced facts, relations with evidence sentences, contradictions, supersession |
| "Who asked for it?" | ✗ | ✓ Stakeholders, customers, people, with quotes |
| Notifications / watches | ✗ | ✓ `create_subscription` on beacon, spec and PR events; Slack DMs |
| Team / multi-user | Self-hosted HTTP server with one shared bearer token; no accounts or RBAC | Org workspaces, OAuth, scoped API keys |

## PR review

- **Gortex** (`gortex prs`, `gortex review`, `pr_risk`, `triage_prs`, `suggest_reviewers`):
  - **Code risk:** per-PR blast radius, a 5-axis risk score, and merge-order conflicts.
  - **Verdict:** a rulepack verdict (BLOCK/REVIEW/APPROVE), with rules for **Go and Python only**.
  - **Optional LLM critique.**
  - **Posting:** comments can be posted to GitHub.
- **nima:**
  - **Intent check:** checks whether the PR **did what the spec asked** (drift per spec section).
  - **Card link:** links the PR to its card or ticket.
  - **Watches:** lets people watch PR events.

These don't compete: Gortex reviews code risk; nima reviews against intent.

## Benchmarks, read critically

- **Scale:** the Gortex README claims Linux (70k files) indexes in ~3 min and VS Code in ~1 min.
- **Same-machine numbers:** everything in `BENCHMARK.md` is self-run on one M3 Max:
  - The token comparison uses 8 queries against Gortex's own repo; it claims "3–50× fewer tokens" than ripgrep.
  - Retrieval recall: R@5 is **55%** overall, 97% for exact names, and **25% for concept queries**.
- **SWE-bench:** `BENCHMARK-SWE.md` is an empty template ("Last run: TBD").
- **nima:** nima has no published retrieval benchmark either.

## Gortex's weaknesses (for sales conversations)

1. **Each developer runs their own copy.** There is no shared org index, no SSO and no RBAC, and every developer re-indexes locally.
2. **No product context.** It has no Slack, Linear, Jira, HubSpot or customer data. Its `why` only knows what someone wrote into the repo.
3. **No spec lifecycle and no drift check.** It cannot say whether a PR did what the spec asked.
4. **Its surface is large and inconsistent.** The docs cite 100+, 175, and ~197 tools in different places, plus 59 `analyze` kinds; the 21-tool facade exists to manage that.
5. **Maintainer risk.** One maintainer does most of the work (5 active contributors).

## What nima can learn from Gortex (ranked by ROI)

1. **Extend call edges beyond TS/JS.**
   - **Gap:** nima's `blast_radius` is import-level for Python, Go, Rust and the rest.
   - **Why it matters:** this is the most visible gap if a buyer compares the two tools side by side.
   - **Cost:** the tree-sitter extractors already exist, so this is incremental work.
2. **Tier blast radius by depth.**
   - **Idea:** label depth 1 "will break", depth 2 "likely affected", depth 3 "needs testing", as Gortex's `explain_change_impact` does.
   - **Why it matters:** agents can act on these labels, and they are cheap to add on top of the existing distance data.
3. **Add a token-savings receipt.**
   - **Idea:** Gortex's `gortex savings` reports dollars avoided (e.g. "$168 saved"), which works well as marketing.
   - **Opportunity:** nima could report something like "N decisions surfaced / M regressions avoided" per spec.
4. **Offer one-command setup for many agents.**
   - **Gortex:** `gortex install` configures 19 agents.
   - **nima today:** configured per agent (`claude mcp add` / `codex mcp add`).
   - **Idea:** a `npx @getnima/setup` that detects installed agents would lower time-to-first-value.
5. **Make integration a feature, not a fight.** Position nima as the **"why" layer that sits next to local code graphs**. A "Works with Gortex" note (and a `/nima` skill line saying "use gortex or grep for code, nima for why/who") catches their ~1.8k-star audience instead of competing on parsing depth.

## Suggested one-liner for a comparison page

> **Gortex tells your agent what the code does. nima tells it why the code exists, who asked for it, and whether the PR shipped what the spec promised.** Use both.
