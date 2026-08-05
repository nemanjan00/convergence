# Block Contract (v0 draft)

A **block** is any service that speaks this contract. Language-agnostic,
independently deployable and scalable. This is the single most important
interface in the system — everything else builds on it.

## Model: pull work, push results

The runtime owns queues. A block does not know about the flow, only about work
items on its input queue.

```
runtime ──(work item)──▶ block input queue ──▶ block ──(result)──▶ runtime
                              ▲                                       │
                              └───────── backpressure ◀──────────────┘
```

- **Pull:** block reads a work item from its input (queue/stream).
- **Push:** block emits zero or more results.
- **Backpressure:** if a block's input queue is full, the runtime stops feeding
  it and that pressure propagates upstream to the source (which slows/samples).

## Work item envelope

```json
{
  "flow": "ct-recon",
  "run": "2026-08-05T12:00:00Z/abcd",
  "block": "scan",
  "item_id": "01J...",              // unique, for dedup + idempotency
  "trace": ["ct", "resolve"],        // provenance chain so far
  "input": { "target": "93.184.216.34", "args": "-sV --top-ports 100" }
}
```

## Result envelope

```json
{
  "item_id": "01J...",
  "block": "scan",
  "ok": true,
  "fields": {                        // becomes entity fields
    "open_ports": [80, 443],
    "services": [{ "port": 443, "name": "https", "product": "nginx" }]
  },
  "provenance": {                    // attached to EVERY field
    "block": "scan",
    "source_item": "01J...",
    "at": "2026-08-05T12:03:11Z",
    "raw_ref": "gridfs://raw/01J..." // pointer to raw output, not inline
  },
  "emit": []                          // optional: new entities/work to spawn
}
```

## Invariants (non-negotiable)

1. **Idempotent by `item_id`.** Same item processed twice ⇒ same result, no
   double-writes. This is how we survive restarts and get persistence for free.
2. **Provenance on every field.** No field enters an entity without saying where
   it came from. This is the moat; it is not optional.
3. **Raw output is referenced, not inlined.** Big blobs (nmap XML, HTML) go to
   object storage; the result carries a pointer. Keeps queues and Mongo lean.
4. **Blocks are stateless.** All state lives in the runtime/store. A block can
   be killed and respawned at any time.
5. **Rate limits are declared, enforced by runtime.** A block never implements
   its own rate limiting; the flow declares `rate:` and the runtime honors it.

## Block-authoring conventions (house style)

Real blocks wrap existing recon libraries into the contract. They follow a
consistent shape so they compose and stay cheap at scale:

- **Service-object shape.** A block is an object with methods and `_private`
  members (e.g. `_client`, `_request`), named for *what it does* (`whois`,
  `resolver`), not the library behind it. See the `implement-js` skill.
- **Rate limiting is a wrapper, never inline.** Wrap the network call with
  `queue-promised` `wrapper(fn, { count, minTime })` — `count` = concurrency,
  `minTime` = min ms between resolves. The runtime sets these from the flow's
  `rate:` (`max_concurrent` → `count`, `max_per_min` → `minTime`).
- **Cache aggressively in Redis.** Recon facts are stable; cache by natural key
  with a long TTL (the IP-lookup block uses a 1-week TTL, `mget` for batch
  reads, a `pipeline` for batch writes). A cache hit must skip the network.
- **Retry + rotate as composable wrappers.** TTL-bounded retry around flaky
  lookups; a weighted `balancer` for rotating identities (user agents via
  coverage weight, proxy egress via nearest-country, DNS servers at random).
- **Lazy-load ESM deps.** Use `src/utils/load` for pure-ESM libraries
  (`node-rdap-*`, fingerprinters) so CommonJS blocks need no build step.

### Ported toolkit (existing recon primitives, now in house style)

These are in-repo, lint-clean, and (where offline-testable) unit-tested. They
become the backing services for real blocks under the contract.

| Piece | Location | Role | Status |
| --- | --- | --- | --- |
| lazy `load()` | `utils/load` | use ESM-only libs from CJS (lazy import) | ✅ done |
| balancer | `utils/balancer` | weighted-random pool (rotation primitive) | ✅ tested |
| ip | `utils/ip` | mask + enumerate containing nets (v4/v6) | ✅ tested |
| subnet | `utils/subnet` | VLSM subnet layout | ✅ tested |
| geo | `utils/geo` | nearest available proxy country | ✅ tested |
| retry | `utils/retry` | TTL-bounded retry wrapper | ✅ tested |
| random-ip | `utils/random-ip` | random egress IP in owned ranges (v4/v6) | ✅ tested |
| useragent | `utils/useragent` | coverage-weighted realistic UA rotation | ✅ loads |
| dns-cache | `utils/dns-cache` | process-local caching lookup (net.connect compat) | ✅ done |
| cache | `services/cache` | Redis or in-memory fallback (get/mget/msetEx) | ✅ tested |
| resolver | `services/resolver` | rotating-server, bogus-filtered DNS | ✅ loads |
| dns-picker | `services/dns-picker` | IPv6-preferring address picker | ✅ loads |
| asn | `services/asn` | IP → ASN + prefix (Team Cymru bulk whois) | ✅ loads |
| rdap | `services/rdap` | registrar/abuse/range, cached; needs node-rdap-lacnic | ✅ loads |
| ip-lookup | `services/ip-lookup` | batched IP → {asn, prefix, whois}, 1wk cache | ✅ loads |
| ip-country | `services/ip-country` | IP → country via country-ip-blocks | ✅ tested |

"loads" = requires cleanly and is wired; live behavior needs network/data (see
`docs/DATA_SOURCES.md`). Next: wrap these as contract blocks (a block adapts a
service's method into the work-item/result envelope) and add the CT-log source.

## Why this shrinks AI error surface

The AI never writes any of the above. It picks a block by name, wires
`inputs`/`merge_into`, and declares `rate`/`when`. Retries, dedup, provenance,
backpressure, and parsing are the platform's job — written once, tested once.
