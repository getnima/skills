---
name: nima
description: Ask nima's knowledge graph, a product team's organizational memory, through the ask_knowledge_graph MCP tool, and read the answer correctly. Use it whenever a task touches product history or customer evidence, even when nima is not mentioned - whether anyone asked for something and what they said, who a person is and what they have asked for, why a decision or change was made, what customers think about an area, what was tried or rejected, or how a feature, need, person or constraint connects to others. Use it before writing a spec, PRD or proposal that claims demand, and before answering "nobody asked for this". Not for locating code or anything grep answers.
---

# nima knowledge graph

nima's knowledge graph is a product team's organizational memory. nima builds it
from everything it reads: customer signals from Slack, GitHub, HubSpot, Granola,
Linear, PostHog and Sentry, pull requests and their reviews, specs, commits and
PM notes. Each source becomes **entities** (a feature, a user need, a customer, a
technical decision) carrying **facts** with their source and date, **relations**
between entities with the sentence that proves them, and **contradictions** nima
has noticed and not resolved.

It holds what a codebase cannot: who asked for a feature and what they said, why
a line was written, what was decided and what was rejected. A repository can only
ever show the absence of a request, so if a question is about people, requests
or decisions and you have not asked the graph, you have not looked.

The graph is scoped to the one workspace the user connected, and the tool is
read-only.

## Connect

The server is `https://mcp.getnima.io/mcp`. Connecting starts an OAuth flow that
ends on nima's consent screen; the tool needs the `knowledge:read` permission.

```bash
# Claude Code, then /mcp, sign in, Allow
claude mcp add --transport http nima https://mcp.getnima.io/mcp

# Codex CLI (registers its own OAuth client; `codex mcp list` shows "OAuth" when done)
codex mcp add nima --url https://mcp.getnima.io/mcp
codex mcp login nima
```

Claude.ai and Claude Desktop: Settings → Connectors → Add custom connector, paste
the URL, leave client id and secret blank. Without a browser (CI, headless
agents), create a personal API key in nima under Settings → API keys with
`knowledge:read` and send it as a bearer token:

```bash
claude mcp add --transport http nima https://mcp.getnima.io/mcp \
  --header "Authorization: Bearer nima_…"
```

```toml
# ~/.codex/config.toml
[mcp_servers.nima]
url = "https://mcp.getnima.io/mcp"
bearer_token_env_var = "NIMA_API_KEY"   # omit for OAuth
```

Smoke test: `ask_knowledge_graph q="what is this product" limit=3`. If the tool is
missing, `knowledge:read` was not granted: disconnect, reconnect, grant it. If
the entities describe another company, the wrong workspace was connected:
switch workspaces in nima, then reconnect. Full docs:
https://docs.getnima.io/docs/mcp-server/overview/

## Ask

`ask_knowledge_graph(q, limit?)` embeds the question, compares it with every
entity's summary paragraph, and returns the closest entities (cosine similarity
of 0.6 or better) as markdown with their facts, relations and open
contradictions. It is retrieval, not a chat model: it hands you evidence, and you
read it.

- **Describe the thing the way a summary of it would read.** The match is
  against summary paragraphs, so "customers asking to export their data as
  CSV" lands and "CSV" alone drifts. Plain English, 2 to 500 characters, one
  question per call: two questions in one string embed to the average of both.
- **People: name first, then their topics.** A bare name finds a person who is
  mentioned often; it can miss someone mentioned once or twice. A person's own
  entity is thin (a role, a channel); the substance sits in the entities that
  point at them: their requests, the meetings they were in, the PRs that cite
  them. So for "who is X and what did they ask for", ask `q="X"` with
  `limit=15`, then ask about the things the relations name.
- **`limit`** is entities returned, default 8, maximum 20. Raise it for a
  survey or a person, lower it for a pointed question.
- **Each entity shows its top five facts and five relations, and rewording the
  question does not change which five.** To see more, pivot to a neighbouring
  entity: ask about the request itself, the meeting, the feature. That surfaces
  a different entity with its own five and its own source ids.
- **Rephrase before concluding silence.** Try the product-area name, a
  synonym, the customer's own wording. Two or three angles, then stop.
- **Do not call it for code.** Where a symbol lives, what a function does, how
  many files a module has: read the tree or grep. The graph's code facts carry
  no commit stamp and lag the repository.

## Read the result

```
Knowledge graph results for: "<your question>"

### <Entity name> (<entity type>)
References: 12 | Similarity: 0.732
Summary: <one paragraph>
⚠ Summary is stale since 2026-09-03T06:02:08Z; verify against the source facts.
Facts:
  - <key>: <value> (source: SIGNAL:<uuid>, learned 2026-09-17) — "<excerpt…>"
  - <key>: <value> (source: PR:<uuid>, learned 2026-09-07)
  … 3 more facts omitted.
⚠ contradicted: <key> "<value A>" (<source A>) vs "<value B>" (<source B>), 2026-09-10
Relations:
  - implements → <Target entity> (<type>) — "<evidence sentence>"
```

- **Entity type** is one of `feature`, `user_need`, `technical_decision`,
  `constraint`, `requirement`, `goal`, `product`, `customer`, `person`,
  `organization`, `signal`, `discovered_concept`. A `discovered_concept` is
  something nima inferred rather than was told; weigh it below a typed entity
  with cited facts.
- **References** is how many sources mention the entity: how much the
  workspace talks about it, not how important it is. Counts of 1 are common.
- **Similarity** orders the list and is closeness to your question, not truth
  and not relevance. Read the facts before ranking results; never present the
  number as confidence.
- **Summary** is an LLM digest. When the stale warning is present, the facts
  below were learned after it was written: trust the facts.
- **Facts** each carry a source and the date nima learned them. Sources are
  `SIGNAL:<id>`, `PR:<id>`, `SPEC:<id>`, `SLACK:<id>`, `COMMIT:<sha>`,
  `PR_REVIEW:<id>`, `PM_INPUT:<id>`, or a URL for `WEB_RESEARCH` and
  `MARKETING_PAGE`. `INFERRED` means nima derived the fact. The quoted excerpt
  is verbatim source text and is the right thing to quote to a human.
- **⚠ contradicted** means two facts with the same key disagree and nima has
  not resolved it. Report both values with their sources; never pick one
  silently.
- **Relations** carry an evidence sentence: the source's own framing of why
  the two entities connect, and often the customer's actual words. It is
  usually the most quotable line in the result.

## Gotchas

Each of these has cost an agent a wrong answer or a dropped connection.

1. **"No product entities found" means nothing scored above 0.6**, not that
   nothing exists and not that nobody asked. Rephrase two or three times, then
   say the workspace holds no record of it.
2. **Exact strings miss.** There is no keyword channel, so ticket keys, error
   messages, function names and UUIDs return nothing or noise. Describe the
   thing in words instead.
3. **The same thing can appear as several entities**: a `feature` and a
   `discovered_concept` with near-identical names, two `technical_decision`s
   for one PR learned in separate passes, or one Slack message fanned out into
   a `signal` and three `user_need`s. Resolution is keyed by type and by pass,
   so copies survive. Trace the sources: entities citing the same `SIGNAL:` or
   `PR:` id are one thing. Merge them when you answer; six entities citing one
   signal are one ask, not six.
4. **An excerpt ending in `…` is a 120-character window**, not the whole
   quote. `… N more facts omitted` means the entity has more than the five
   shown, and no rewording reveals them (see Ask). Fetch the source when the
   exact wording matters.
5. **A summary can be wrong in the direction that hurts most.** One entity's
   summary read "Customer inquiry asking about…" for a signal whose origin was
   internal. Summaries are drafted by an LLM from whatever it saw first; take
   who-said-it from facts, excerpts and relation evidence, never from the
   summary line.
6. **A `SIGNAL:` source can be a teammate, not a customer.** The result does
   not show a signal's origin, so an internal note in a team channel and a
   customer's message look the same. Attribute a request to a customer only
   when the excerpt or evidence says who said it. With `signals:read` also
   granted, `get_signal(id)` returns `origin` (customer, external, internal)
   and the full text. A person's own facts are usually `SLACK:` or `PR:`
   sourced; the `SIGNAL:` id is one hop away, on the entity for the request
   itself.
7. **Contradictions are flagged only between facts sharing a key, and a flag
   can be a false positive.** Two different bugs reported the same day under
   one key show up as "contradicted". Read both values before calling it a
   conflict. Conversely, two entities that disagree, or a summary that
   disagrees with a fact, carry no ⚠ line: compare across entities yourself.
8. **Ids are nima's own, and some things are not in the graph at all.**
   `PR:<uuid>` is not a GitHub number, `SLACK:<id>` is not a permalink, and a
   Slack user id like `U0BTC5C8X7X` resolves to no name through any nima tool.
   The graph records what a PR says, not who wrote or reviewed it: for an
   author, use `git log` or `gh pr view`, and say so instead of asking the
   graph a fourth way. A `SPEC:` id opens with `get_document_markdown` when
   `documents:read` was granted.
9. **Learned is not said.** The fact's date is when nima extracted it; the
   source may be older. The graph is fed by background jobs, so something
   posted minutes ago may not be in it yet. Do not read absence as evidence
   for very recent events.
10. **One call at a time.** nima allows roughly 100 tool calls a minute per
    caller across all its tools, and parallel fan-outs (several subagents each
    asking three ways, or five calls fired at once) are what trip it. A 429
    means wait, not retry. Three or four sequential, differently phrased
    questions cover almost anything; a run that needed fourteen calls was
    guessing.
11. **Listed is not granted.** A tool can appear in your tool list and still
    answer "needs additional permissions" because the token predates that
    scope or the scope is owner-only (`sources:read`). In Claude Code that
    error can drop the whole nima server until `/mcp` re-authenticates. Do not
    retry; tell the user which scope to grant on reconnect, and finish with
    what the graph already gave you.
12. **Questions are 2 to 500 characters.** Longer text is rejected; do not
    paste a spec in as the question. A reply of "Could not generate an
    embedding" is transient: retry once.
13. **A connection is one workspace.** Someone in several workspaces gets the
    one that was active at connect time. OAuth access lapses after about 30
    days and API keys expire on the schedule chosen at creation; a tool that
    stops appearing usually means reconnect, not an outage.

## Answer

Lead with what the graph says, then who said it and when, then what is
contradicted, thin or missing. Cite sources the way the graph does (`SIGNAL:…`,
`PR:…`) so the reader can follow them in nima. Distinguish told from inferred:
cited facts and relation evidence are told; summaries, `discovered_concept`
entities and `INFERRED` sources are nima's reading. Two role or status facts
that differ are usually two sources at two times, not a contradiction to
adjudicate: give both with their dates. Never invent an id, an entity or a
quote that was not in a result. When the graph is silent, say so in those
words, and say what you asked.

## Examples

**"Has anyone asked for CSV export?"**
`q="customers asking to export their data as CSV"`. Read any `user_need` or
`feature`: facts say what was asked and when, relation evidence says who and in
what words, `SIGNAL:` sources point at the reports. Check origin before calling
it customer demand. If nothing comes back, try `q="exporting reports to a
spreadsheet"`, then answer that the workspace has no record of it, which is not
the same as nobody having asked.

**"Why did we split X from Y? Who decided?"**
`q="decision to split X from Y"`. Expect a `technical_decision` or `constraint`
with `PR:` sourced facts; quote the relation evidence, which is usually the PR's
own reasoning. For the "who", answer from `git log`, not the graph.

**"Who is Alon and what has he asked for? I'm about to reply."**
`q="Alon Kivity" limit=15`. His entity gives role and channel; the `requested →`
relations give the asks in his words. Then `q="<one of those requests>"` to reach
the request's own entity and `SIGNAL:` id for the full text and origin. Report
role facts with their dates, merge twins, and say how many relations you did not
open.

## Plain HTTP

```bash
curl -H "Authorization: Bearer nima_…" \
  "https://api.getnima.io/v1/knowledge-graph/ask?q=what+customers+say+about+onboarding&limit=8"
```

Returns the same markdown as `text/markdown`.
