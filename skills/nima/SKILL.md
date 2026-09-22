---
name: nima
description: Ask nima's knowledge graph, the organizational memory of a product team, through the ask_knowledge_graph MCP tool. Use whenever a question is about why a product decision was made, who asked for something and what they said, what customers think about an area, or how features, needs, people and constraints connect. Do not use for exact code lookups that grep answers.
---

# nima knowledge graph

nima's knowledge graph is a product team's organizational memory. nima builds it
from everything it reads: customer signals from Slack, GitHub, HubSpot, Granola,
Linear, PostHog and Sentry, pull requests and their reviews, specs, commits and
PM notes. Each of those becomes **entities** (a feature, a user need, a
customer, a technical decision) carrying **facts** with their source and date,
**relations** between entities with the sentence that proves them, and
**contradictions** nima has noticed and not resolved.

It holds what a codebase cannot: who asked for a feature and what they said,
why a line was written, what was decided and what was rejected, what is true in
the product today. If a question is about people, requests or decisions and you
have not asked the graph, you have not looked.

This skill is for an agent connected to nima's remote MCP server. The graph is
scoped to the one workspace the user connected, and the tool is read-only.

## Connect

The server is `https://mcp.getnima.io/mcp`. Connecting starts an OAuth flow
that ends on nima's consent screen; the tool needs the `knowledge:read`
permission ("Search what nima knows about your product").

**Claude Code**

```bash
claude mcp add --transport http nima https://mcp.getnima.io/mcp
```

Then `/mcp`, sign in, **Allow**.

**Codex CLI**

```bash
codex mcp add nima --url https://mcp.getnima.io/mcp
codex mcp login nima
```

Codex registers itself as an OAuth client automatically; no client id is
needed. `codex mcp list` shows `nima … enabled  OAuth` once it worked. The
same thing in `~/.codex/config.toml`:

```toml
[mcp_servers.nima]
url = "https://mcp.getnima.io/mcp"
```

**Claude.ai and Claude Desktop**: Settings → Connectors → Add custom connector,
paste the URL, leave client id and secret blank, **Connect**, **Allow**.

**Without a browser** (CI, scripts, headless agents): create a personal API key
in nima under Settings → API keys with `knowledge:read`, and send it as a
bearer token instead of signing in.

```bash
# Claude Code
claude mcp add --transport http nima https://mcp.getnima.io/mcp \
  --header "Authorization: Bearer nima_…"
```

```toml
# Codex: ~/.codex/config.toml, token read from the environment
[mcp_servers.nima]
url = "https://mcp.getnima.io/mcp"
bearer_token_env_var = "NIMA_API_KEY"
```

Smoke test before anything else:

```
ask_knowledge_graph  q="what is this product"  limit=3
```

If `ask_knowledge_graph` is not in the tool list, `knowledge:read` was not
granted at connect time: disconnect, reconnect, grant it. If the entities
describe another company's product, the user connected the wrong workspace:
switch workspaces in nima, then reconnect.

## Asking

`ask_knowledge_graph(q, limit?)` embeds the question, finds the nearest
entities and returns them as markdown with their facts, relations and open
contradictions. It is retrieval, not a chat model: it does not compose an
answer, it hands you the evidence and you read it.

- **Ask by topic, not by name.** "what do customers say about onboarding",
  "why was the legacy importer dropped", "beacon ranking". A bare person or
  company name often returns nothing even when the graph holds that person with
  attributed requests. Ask about the thing they asked for and read the
  relations back to them.
- **One question per call**, 2 to 500 characters, plain English. Two questions
  in one string dilute the embedding and return the average of both.
- **`limit`** is how many entities come back: default 8, maximum 20. Raise it
  for a survey ("everything around billing"), lower it for a pointed question.
- **Follow up by entity name.** When a result mentions an entity you did not
  ask about, ask again with its name plus its type word ("weighted reach user
  need") to pull that entity's own facts and relations.
- **Ask again from a different angle** before concluding the graph is silent:
  the product area, a synonym, the customer's own wording.

## Reading a result

```
Knowledge graph results for: "<your question>"

### <Entity name> (<entity type>)
References: 12 | Similarity: 0.732
Summary: <one-paragraph summary>
⚠ Summary is stale since 2026-09-03T06:02:08Z; verify against the source facts.
Facts:
  - <key>: <value> (source: SIGNAL:<uuid>, learned 2026-09-17) — "<source excerpt…>"
  - <key>: <value> (source: PR:<uuid>, learned 2026-09-07)
  … 3 more facts omitted.
⚠ contradicted: <key> "<value A>" (<source A>) vs "<value B>" (<source B>), 2026-09-10
Relations:
  - implements → <Target entity> (<type>) — "<evidence sentence>"
  - relates_to → <Target entity> (<type>) — "<evidence sentence>"
```

Line by line:

- **Entity type** is one of `feature`, `user_need`, `technical_decision`,
  `constraint`, `requirement`, `goal`, `product`, `customer`, `person`,
  `organization`, `signal`, `discovered_concept`. A `discovered_concept` is
  something nima inferred rather than was told; weigh it below a `feature` or
  `technical_decision` that carries cited facts.
- **References** is how many sources mention the entity: how much the
  workspace talks about it, not how important it is.
- **Similarity** is cosine closeness to your question, not truth and not
  relevance. A 0.70 hit can be the answer and a 0.75 hit can be noise. Read the
  facts before ranking results, and never quote the number as confidence.
- **Summary** is an LLM digest that can lag behind the facts. When the stale
  warning is present, the facts below were learned after the summary was
  written: trust the facts.
- **Facts** are `key: value` pairs, each with a source and the date nima
  learned it. Sources are `SIGNAL:<id>`, `PR:<id>`, `SPEC:<id>`,
  `SLACK:<id>`, `COMMIT:<sha>`, `PR_REVIEW:<id>`, `PM_INPUT:<id>`, or a URL
  for `WEB_RESEARCH` and `MARKETING_PAGE`. `INFERRED` means nima derived the
  fact rather than read it. A quoted excerpt after a fact is verbatim source
  text and is the right thing to quote to a human. A `SIGNAL:` id is the
  signal nima extracted the fact from; if the workspace also granted
  `signals:read`, `get_signal(id)` returns its full text.
- **⚠ contradicted** means two sources disagree and nima has not resolved it.
  Report both values with their sources; do not pick one silently.
- **Relations** carry an evidence sentence. That sentence is usually the most
  quotable line in the whole result: the source's own framing of why the two
  entities connect, and often the customer's actual ask.
- **Omitted lines** (`… N more facts omitted`) mean the entity has more than
  five facts or relations. Ask a narrower question about that entity to see the
  rest.
- **"No product entities found"** means nothing in the graph sits near your
  question. It is not evidence that the thing does not exist or that nobody
  asked. Rephrase once or twice, then say plainly that the workspace holds no
  record of it.

## Answering from it

- Lead with what the graph says, then who said it and when, then what is
  contradicted or missing. Cite sources as the graph does (`SIGNAL:…`,
  `PR:…`) so the reader can follow them in nima.
- Distinguish **told** from **inferred**: cited facts and relation evidence
  are told; summaries, `discovered_concept` entities and `INFERRED` sources are
  nima's reading.
- Facts that describe code (file counts, module edges, what a service does)
  carry no commit stamp and can lag the repository. For anything structural,
  confirm in the tree.
- Never invent an id, an entity or a quote that was not in a result.

## Worked examples

**"Has anyone asked for CSV export?"**
`ask_knowledge_graph q="CSV export requests"`. Read any `user_need` or
`feature` entity: its facts say what was asked and when, the relation evidence
says who and in what words, and `SIGNAL:` sources point at the reports. If
nothing comes back, try `q="exporting data to a spreadsheet"`, then say the
workspace has no record of it, which is different from nobody having asked.

**"Why is animation disabled on the dashboard?"**
`ask_knowledge_graph q="dashboard animation disabled"`. Look for a
`technical_decision` or `constraint` entity and a `PR:` sourced fact; quote
the relation evidence, which is usually the PR's own reasoning.

**"What do customers think about billing?"**
`ask_knowledge_graph q="what customers say about billing" limit=15`. Group the
entities by type: `customer` and `person` say who, `user_need` says what they
want, `feature` says what exists, `⚠ contradicted` lines say where the record
disagrees with itself.

## Plain HTTP

The same query over the API, for scripts:

```bash
curl -H "Authorization: Bearer nima_…" \
  "https://api.getnima.io/v1/knowledge-graph/ask?q=what+do+customers+say+about+onboarding&limit=8"
```

It returns the markdown above as `text/markdown`.

Connect and API-key docs: https://docs.getnima.io/docs/mcp-server/overview/
