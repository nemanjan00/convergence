# Data Model (v0)

How entities, provenance, lineage, and convergence actually work — the model the
store, engine, and blocks build against. Every decision here is chosen so the
result is **validatable, testable, and showable**.

## Entities

An **entity** is a schemaless document with an identity and per-field
provenance:

```json
{
  "_type": "host",
  "_key": "name=\"a.example.com\"",
  "_version": 4,
  "fields": {
    "name": { "value": "a.example.com", "provenance": { "block": "fanout", "at": "…" } },
    "ip":   { "value": "93.184.216.34", "provenance": { "block": "resolve", "at": "…" } }
  }
}
```

- **Type** is declared centrally in the flow's `entities:` block (with `key` +
  `merge`). Sources `emit` a declared type; blocks pick `for_each` (input type)
  and `merge_into` (output type) among declared types.
- **Identity** (`_key`) is derived from the type's `key` fields. Same key ⇒ same
  entity ⇒ merge (dedup across all discovery paths).
- **`_version`** bumps only when a merge actually changes the entity. It is the
  engine's convergence signal (see below).

**Storage (Mongo target):** a single `entities` collection keyed by
`(_type, _key)`, indexed on `_type` + key fields — not one collection per type,
because entity types are open-ended. The in-memory store is the reference
implementation of this shape.

## Two kinds of block: enrichment vs derivation

Decided by whether `merge_into` equals `for_each`:

- **Enrichment** (`host → host`): adds fields to the *same* entity, in place.
- **Derivation** (`cert → host`): produces entities of a *different* type.
  **Fan-out** is the plural case — one parent → many children.

## Lineage: edges are first-class

Field provenance answers "which block set this value." **Lineage** answers "which
*entity* did this come from" — a different question, so it is a first-class
**edge**, not a field:

```json
{ "from": {"type":"cert","key":"id=123"}, "rel":"has_san",
  "to": {"type":"host","key":"name=\"a.example.com\""}, "via":"fanout", "at":"…" }
```

- The engine records an edge **automatically on every derivation**
  (`merge_into ≠ for_each`): `parent —rel→ child`, where `rel` is the block's
  `relation:` (default: the block id). Enrichment records none (same entity).
- Edges live in their own `edges` store, indexed both directions. The edge graph
  IS the recon product: pivot cert→hosts, ip→domains, person→assets. A host
  derived from three certs simply has three edges.
- The parent is **not consumed or mutated** by derivation — it stays as its own
  entity and pivot point.

## Typed fields that build the graph

An entity type may give a field a **type hint** that `links` it to another entity
type. When a block writes such a field, the engine **auto-materializes** the
linked entity (keyed by the field's value) and records an edge — so typed fields
grow the graph on their own. It is a generalization of `fanout`: any typed value
can spawn/connect an entity.

```yaml
entities:
  host:
    key: [name]
    fields:
      ip:                    # host.ip is an `ip`
        links: ip            #   -> materialize an `ip` entity keyed by...
        as: address          #   ...address = <the value>
        rel: resolves_to     #   with edge host --resolves_to--> ip
  ip:
    key: [address]
```

Now any block that sets `host.ip` (dns, a cert grab, a leak dump — a million
paths) causes the same `ip` node to exist and link, and blocks `for_each: ip`
enrich it. Types are a property of the DATA, not the plumbing — unlike
port-typed dataflow tools where types live on the edges. Array-valued fields
link one entity per element. Linking is idempotent (no-op re-writes don't
re-link).

## Merge strategies (convergence depends on this)

Convergence terminates only if entity state is **monotonic** (facts accumulate,
never oscillate). So:

| strategy | monotonic? | semantics |
| --- | --- | --- |
| `first-write-wins-with-provenance` | ✅ (**default**) | first value sticks; later writes ignored (kept in history). Scalars stay scalars. |
| `union-with-provenance` | ✅ | field is a set; new distinct values appended. For accumulating fields (observed ports/ips). |
| `last-write-wins-with-provenance` | ⚠️ no | newer timestamp wins; **can oscillate** if two blocks write one field. Available, but flagged; `MAX_SWEEPS` backstop only. |

A no-op merge (same value / no new set element) returns the **same field object**,
so `_version` does not move — this is what makes the fixpoint terminate.
(Per-field strategy is a future refinement; today it is per entity type.)

## Convergence: a change-driven fixpoint, not a feedback loop

A synchronous feedback loop (write → re-invoke self) is explicitly rejected —
unbounded and reentrant. Instead, incremental fixpoint evaluation (the shape of
incremental view maintenance / semi-naïve Datalog):

1. Source **seeds** entities of type `emits`; `filter` drops non-matches.
2. The engine evaluates each block against every entity of its `for_each` type
   it has **not processed at that entity's current `_version`**: check `when`
   against current state, run, merge (+ record a lineage edge if deriving).
3. A merge that **changes** an entity bumps `_version`, making dependent blocks
   eligible again — a **fact fires its reactions regardless of which block
   produced it**.
4. Repeat until a pass changes nothing — the **fixpoint**. Guaranteed to
   terminate under monotonic merges (version-gating + idempotent merges);
   `MAX_SWEEPS` is a backstop for the non-monotonic strategy.

**Batch vs streaming:** `src/engine` implements this as in-memory sweeps (the
semantic reference). Production is the same fixpoint driven by a **durable work
queue** — a `_version` bump enqueues `{entity, version}`, workers evaluate
eligible blocks, and the queue drains to quiescence. No recursion; restart-safe.

## Fan-out block (`uses: fanout`)

Derivation configured declaratively:

```yaml
- id: fanout
  uses: fanout
  for_each: cert
  inputs:
    items: "{{ cert.san }}"      # the array to explode (definable projection)
    as: name                     # child identity field <- element
    carry: { first_seen: "{{ cert.not_before }}" }   # optional fields copied onto each child
  merge_into: host               # child type
  relation: has_san              # lineage edge label cert --has_san--> host
```

Returns one field-set per element; the engine upserts one child per element and
records the `has_san` edge from the parent cert to each child host.

## Validatable / testable / showable

- **Validatable:** the loader rejects flows that break the model (undeclared
  types, dangling `for_each`, cross-type cycles, bad `relation`).
- **Testable:** merge strategies, edge recording, and convergence are unit-tested
  on the in-memory store/engine with deterministic blocks.
- **Showable:** a run yields entities (fields + provenance) **and** the edge
  graph — `yarn flow` prints both, and it is the data the qrp explorer renders.
