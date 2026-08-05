# Architecture

> Working name: TBD. Referred to here as **the platform**.

## One sentence

A declarative, versioned engine for large-scale cyber-recon flows, where **AI
authors flows and humans build/edit them visually, but neither executes them** —
a deterministic runtime does.

## The problem

LLM agents are bad at exactly the things recon demands:

- **They skip steps.** Long procedures lose fidelity.
- **They forget.** Context compaction silently drops earlier decisions.
- **They can't do high throughput.** An agent cannot personally process 50k new
  certs/hour off a CT firehose.
- **They aren't persistent.** A flow must run for weeks, survive restarts, and
  resume; an agent session cannot.

## The core bet

> The agent designs the machine. The machine runs. The agent never touches the
> conveyor belt.

This is different from "AI writes code" in one specific way: **we shrink the
surface where AI can be wrong.** Blocks are high-level, story-like verbs
(`for each new cert → whois → nmap → grab title`). The AI composes verbs; it
does not write loops, retries, rate limiters, or parsing. Those are our
problem, tested once, reused forever.

## Two analogies, two axes (keep them separate)

- **Terraform** → the *authoring & state* model. Flows are declarative YAML,
  versioned, diffable, `plan` before `apply`. State is inspectable and owned.
- **GNU Radio** → the *execution* model. A flow is a streaming graph of blocks
  with per-edge backpressure and per-block rate limits. Sources are unbounded
  (CT firehose), blocks fan out, sinks persist.

We take Terraform's ergonomics and GNU Radio's runtime. We are not blending the
two runtimes.

## Why not n8n

n8n passes opaque JSON blobs node-to-node. It has:

- no **domain entity model** (host, cert, domain, ASN, email as first-class
  things with identity and provenance),
- no **entity resolution / merge** across blocks,
- no **premade large-scale recon sources** (queryable CT transparency log as a
  streaming source is the headline example),
- weak **backpressure / persistence** for week-long unbounded streams.

n8n is a workflow tool for SaaS glue. We are a recon substrate.

## The actual moat: entities, not the DAG

A YAML DAG runner is a weekend project. The value is that

```
CT cert → whois → nmap → wappalyzer → title grab
```

does not produce four disconnected JSON blobs. It **converges into one `host`
entity** carrying:

- registrar, TLS provider, cert email(s), SAN list
- IP, IP range, ASN
- open ports + service banners
- detected web stack, page title

…each field annotated with **provenance**: which block, which upstream
response, at which timestamp. Two blocks discovering the same IP by different
paths merge into one entity, not two rows.

That merge-with-provenance is the hard, defensible core.

## Interfaces

- **AI → MCP.** The agent speaks MCP: list blocks, compose a flow, validate,
  submit, inspect state/results. It emits YAML; it does not run anything.
- **Human → Flow Builder.** A visual editor over the same YAML. The YAML is the
  single source of truth both sides read and write. Round-trips must be
  lossless.

## Data plane

- **Flow definition:** YAML. Human-readable, diffable, version-controlled.
- **Data / entities:** MongoDB cluster. Entities are documents; provenance is
  embedded or referenced.
- **Services (blocks):** a standard **ingest push/pull** contract. A block is
  any service that conforms to it — language-agnostic, independently scalable.

## Collaboration

Flows are shared artifacts (YAML in git-like versioning). Entity stores are
shared (Mongo). Multiple operators + agents work the same investigation without
stepping on each other. This is a design requirement, not a later feature.

## Module layering (dependency invariant)

Dependencies point **downward only**, so the pure layers stay frontend-shippable
and parallel contributors rarely collide (each block is its own folder):

1. **stdlib / pure helpers** — `src/stdlib`, `src/utils/{ip,subnet,geo,balancer,retry,load,template,envelope}`. No server/heavy deps; must not import services or anything pulling in the mongo driver / ioredis. Shippable to the browser (e.g. the qrp flow builder can reuse `ip`).
2. **node helpers** — `src/utils/{dns-cache,tls-fingerprint,ja3,useragent}`. Node built-ins / browser-data libs; server-side, still no mongo/redis.
3. **services** — `src/services/*`. The only layer allowed to import server/network deps (store→mongo, cache→redis, rdap→rdap, crtsh→http).
4. **blocks / sources** — `src/blocks/<one-folder-each>`, `src/sources/*`. Use services; one folder per block for collision-free contribution.
5. **engine** — `src/engine`. Orchestrates store + registered block handlers.

Enforced by a guard test (`src/stdlib/__tests__`) that fails if stdlib
transitively loads a server-only dependency.

## Open questions (decide before building)

1. **Block contract wire format** — the exact push/pull envelope + provenance
   fields. Everything else depends on this.
2. **Entity schema & merge rules** — what makes two `host`s the same host? What
   wins on conflict?
3. **Runtime substrate** — queue/stream tech (Kafka? NATS? Redis streams?) for
   backpressured week-long flows.
4. **Backpressure semantics** — what happens when nmap can't keep up with the CT
   firehose? Drop, buffer, sample, or slow the source?
5. **Naming.**
