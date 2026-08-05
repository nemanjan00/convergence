# Flow Spec (v0)

> **This document is the contract.** The MCP interface emits it, the flow
> builder reads and writes it, and the runtime executes it. It is the single
> source of truth. Nothing downstream may invent semantics not defined here.

## Design principles

1. **Declarative, not code.** A flow says *what* happens to data, never *how*.
   The AI composes verbs; it never writes loops, retries, rate limiters, or
   parsing. This is how we shrink the surface where the AI can be wrong.
2. **Mongo dialect everywhere.** Every predicate — source filters, block guards
   — is a MongoDB-style query object, evaluated in-process by `sift` and
   identically against the Mongo cluster for bulk. One query language, authored
   in YAML.
3. **Entities are the output, provenance is automatic.** Blocks contribute
   fields to entities; the runtime stamps provenance on every field. Authors
   never write provenance.
4. **Lossless round-trip.** The flow builder must read this YAML, let a human
   edit it visually, and write it back byte-for-byte equivalent (modulo key
   ordering). No field may exist only in the UI.

## Inspiration (and how we differ)

Two prior arts shape the authoring feel:

- **Ansible** — a flow is a list of declarative tasks; `uses:` is the analog of
  a module, `when:` is Ansible's `when:` (ours is a sift query, not Jinja),
  `for_each:` echoes `loop:`, and entities are like registered facts that
  accumulate. We keep Ansible's **idempotency** contract (re-running converges,
  never double-applies — here via `item_id`).
- **GitLab CI** — the graph model: blocks form a DAG whose edges are *implied by
  data dependencies* (`for_each`/`merge_into`), the way `needs:` builds a job
  DAG. Reuse via `extends:`/`include:` is on the roadmap (see below) so common
  recon sub-flows are composable templates, not copy-paste.

Where we differ from both: they orchestrate **tasks over hosts you own**; we
stream **entities we discover**, merge them with provenance, and run unbounded.

## Top-level shape

```yaml
apiVersion: v0            # spec version; runtime refuses unknown majors
kind: Flow
metadata:
  name: ct-recon          # unique, [a-z0-9-]
  description: ...
  labels: { team: recon } # optional, free-form

entities: { ... }         # entity types this flow produces
sources:   [ ... ]        # unbounded inputs
blocks:    [ ... ]         # enrichment/transform stages
```

## `entities` — the output model

> **Entities are open-ended.** There is NO fixed taxonomy. `host` is just the
> running example. An entity type is whatever the user or AI names it — `person`,
> `domain`, `webpage`, `search_term`, `email`, `asn`, `company`, `leak`,
> `wallet` — a schemaless document identified by whichever fields the author
> declares as its `key`. The platform ships blocks and merge machinery; the
> *entity vocabulary is defined per flow*, in this section. New investigations
> invent new entity types freely.

An entity is a merged, deduplicated document with per-field provenance. You
declare its **identity** (what makes two of them the same) and its **merge**
strategy (who wins on conflict).

```yaml
entities:
  host:
    key: [ip]                              # identity fields (composite allowed)
    merge: last-write-wins-with-provenance  # conflict resolution strategy
  domain:
    key: [fqdn]
    merge: last-write-wins-with-provenance
```

- `key` — one or more field names. Two results with the same key values merge
  into one entity. Composite keys join on all listed fields.
- `merge` — a named strategy the runtime implements. v0 ships
  `last-write-wins-with-provenance` (newer provenance timestamp wins, all
  claims retained in field history). Future: `first-write-wins`, `union`
  (accumulate a set), `numeric-max`, etc. **Authors pick a name; they never
  implement merge logic.**

## `sources` — unbounded inputs

A source is a streaming producer of entities. It is the head of the graph and
the thing that applies backpressure to itself when downstream is slow.

```yaml
sources:
  - id: ct                       # unique within the flow
    block: source.ct-log         # a registered source block
    params:                      # block-specific config
      match_domains: ["*.example.com"]
    emits: cert                  # entity type placed on its output stream
    filter:                      # OPTIONAL sift query; only matching items pass
      cert.is_precert: false
```

- `filter` is a relevance/backpressure gate at the very top: drop uninteresting
  items before they cost anything downstream. Same sift dialect as `when`.

## `blocks` — enrichment stages

A block consumes items from one stream and contributes fields to an entity.

```yaml
blocks:
  - id: resolve                  # unique within the flow
    uses: dns.a           # a registered block type
    for_each: cert               # input stream: items of this entity type
    when:                        # OPTIONAL sift guard, evaluated per item
      cert.san.0: { $exists: true }
    inputs:                      # templated arguments to the block
      name: "{{ cert.san[0] }}"
    merge_into: host             # entity type this block's fields land in
    rate:                        # OPTIONAL; enforced by the RUNTIME, not block
      max_per_min: 60
      max_concurrent: 10
    emit: []                     # OPTIONAL; new items/entities to spawn
```

### `for_each` — the streaming trigger

`for_each: X` subscribes the block to the **stream of `X` items**. This is what
makes the flow a dataflow graph rather than a script:

- `for_each: cert` → runs once per cert emitted by a source.
- `for_each: host` → runs whenever a `host` entity is **created or updated** by
  an upstream block. This is how `nmap` (needs an IP) waits for `resolve` to
  produce one: `resolve` writes `host.ip`, which puts a `host` item on the
  `host` stream, which triggers `nmap`.

The graph edges are implied by `for_each` (input) and `merge_into` (output).
The runtime derives the DAG from them — authors never draw edges by hand.

### `when` — declarative guard

A sift query evaluated against the item's **context** (see below). If it does
not match, the block is skipped for that item. Example: only scan hosts that
resolved.

```yaml
when:
  host.ip: { $ne: null }
```

### `inputs` — templating

`inputs` values are strings with `{{ path }}` interpolation resolved against the
context. Supported path syntax (deliberately minimal — no arbitrary code):

- dotted field access: `{{ host.ip }}`, `{{ cert.issuer.O }}`
- array index: `{{ cert.san[0] }}`
- whole-value passthrough: a value that is exactly `"{{ host.open_ports }}"`
  resolves to the array/object, not its string form.

No expressions, arithmetic, or function calls in templates. If a transform is
needed, it belongs in a block, not a template. (Undefined behavior on missing
paths: resolves to `null`; a `when`/`filter` should have guarded it.)

### Context (what `when` and `{{ }}` see)

For an item flowing through a block, the context is an object with:

- the **triggering entity/item** under its type name (`cert`, or `host` when
  `for_each: host`),
- every **entity merged so far for this item's lineage**, flattened to plain
  values under its type name (`host.ip`, not `host.fields.ip.value`).

So a block `for_each: host` with `when: { host.has_open_443: true }` sees the
current merged host.

### `rate` — runtime-enforced limits

Declared by the author, enforced by the runtime. A block **never** implements
its own rate limiting.

- `max_concurrent` — at most N invocations in flight (backpressure knob).
- `max_per_min` — token-bucket cap for polite third-party APIs (RDAP, CT).

### `emit` — spawning new work (advanced, v0-reserved)

A block may spawn additional items/entities beyond its `merge_into` (e.g. one
cert with 3 SANs emits 3 `domain` items). Shape reserved; documented once the
fan-out semantics are pinned.

## Provenance (automatic — never authored)

Every field written to an entity carries:

```yaml
provenance:
  block: resolve
  source_item: 01J...        # the work item that produced it
  at: 2026-08-05T12:03:11Z
  raw_ref: gridfs://raw/01J... # pointer to raw block output, not inlined
```

This is attached by the runtime on merge. It is the moat; it is not optional and
not author-controlled.

## Execution model (normative)

1. Sources produce entity items onto named streams; `filter` drops
   non-matching items immediately.
2. Each block subscribes to its `for_each` stream. On each item it checks
   `when`, resolves `inputs`, invokes the block type (respecting `rate`), and
   merges returned fields into `merge_into` with provenance.
3. Writing an entity places an updated item on that entity's stream, which may
   trigger further blocks (`for_each: host`). Cycles are rejected at validation.
4. Every edge is a **bounded queue**; a full queue back-pressures its producer,
   ultimately slowing the source. Nothing is dropped except by explicit
   `filter`/`when`.
5. Work items are **idempotent by `item_id`**, so restarts resume without
   double-writing. This is where week-long persistence comes from.

> **Reference implementation note.** The current `src/runtime` runs a
> simplified *ordered pipeline per source item* rather than the full
> stream-triggered graph above — enough to validate entities, provenance, sift
> guards, and backpressure end-to-end. The stream/queue substrate is the next
> milestone; this spec is the target, and the runtime converges to it.

## Validation rules (a flow is rejected if…)

- `apiVersion` major is unknown.
- any `id` (source/block) is not unique.
- a block's `for_each` names a type no source emits and no block `merge_into`s.
- a block's `merge_into` names an entity not declared in `entities`.
- the derived graph contains a cycle.
- a `when`/`filter` is not a valid sift query.
- an `inputs` template references a syntactically invalid path.

## Full example

See [`examples/flows/ct-recon.yaml`](../examples/flows/ct-recon.yaml).
