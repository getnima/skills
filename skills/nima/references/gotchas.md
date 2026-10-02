# nima knowledge graph gotchas

Loaded on demand from the nima skill. Each of these has cost an agent a wrong answer or a dropped connection.

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
   Slack user id like `U0XXXXXXXXX` resolves to no name through any nima tool.
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
