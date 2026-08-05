# recon-flow

Repeatable agentic recon. **An AI composes the dataflow; a deterministic runtime
executes it.** The AI never runs the conveyor belt — it only designs the machine.

## Why

LLM agents skip steps, forget across compaction, can't sustain high throughput,
and don't persist. So we don't let them execute. They author a declarative flow
(high-level, story-like verbs); the runtime does the running — with retries,
rate limits, backpressure, dedup, and provenance handled once, for all flows.

Think **Terraform's authoring & state model + GNU Radio's streaming execution**,
for large-scale reconnaissance. Not n8n: n8n passes opaque JSON between nodes and
has no domain-entity model. Our moat is **entity resolution with provenance** —
many blocks converge into one `host` / `person` / `domain` / `webpage` /
anything, every field annotated with where it came from.

## Interfaces

- **AI → MCP**: list blocks, compose a flow, validate, submit, inspect results.
- **Human → Flow Builder**: a visual editor over the same YAML (single source of
  truth). Planned frontend: [`qrp`](https://www.npmjs.com/package/@nemanjan00/qrp),
  bundled with esbuild.

## Data plane

- **Flows**: YAML — declarative, diffable, versioned. See
  [`docs/FLOW_SPEC.md`](docs/FLOW_SPEC.md) (the contract).
- **Entities**: MongoDB. Schemaless documents, merged by identity, per-field
  provenance.
- **Blocks**: a push/pull service contract. See
  [`docs/BLOCK_CONTRACT.md`](docs/BLOCK_CONTRACT.md).
- **Predicates**: Mongo-style queries (via `sift`) for `when:`/`filter:` —
  declarative in YAML, identical against Mongo.

## Status

Working reference implementation (in-process, offline): config, block-contract
envelopes, entity store with provenance merge, a bounded-concurrency runtime
with sift guards and `queue-promised` rate limiting, a **YAML→flow loader**
(template compilation + full spec validation) so the contract is executable, and
the recon **toolkit ported** into contract-ready services/utils.

```bash
yarn install
yarn flow     # loads, validates, and RUNS examples/flows/ct-recon.yaml
yarn demo     # same pipeline built programmatically
yarn test     # 52 tests
yarn lint
```

`yarn flow` parses the real YAML, validates it (ids, entities, for_each
producers, cycles, sift shape, template paths), compiles `{{ }}` templates, and
executes it — three certs in, the pre-cert dropped by `filter:`, two
fully-provenanced host entities out.

Ported toolkit (see [`docs/BLOCK_CONTRACT.md`](docs/BLOCK_CONTRACT.md)):
`balancer`, `ip`, `subnet`, `geo`, `retry`, `random-ip`, `useragent`,
`dns-cache`, `cache` (redis/in-memory), `resolver`, `dns-picker`, `asn`, `rdap`,
`ip-lookup`, `ip-country`.

Next milestones: wrap those services as real contract blocks + a live
`source.ct-log`; the streaming/queue substrate for unbounded sources; the MCP
interface; and the qrp flow builder. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Flow spec (the contract)](docs/FLOW_SPEC.md)
- [Block contract](docs/BLOCK_CONTRACT.md)
