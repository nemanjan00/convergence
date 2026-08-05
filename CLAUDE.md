# convergence — agent guide

Repeatable agentic recon: an AI composes a declarative YAML flow; a deterministic
**convergence engine** runs it to a fixpoint (blocks re-run on entity-state
changes until nothing changes). See `README.md` and `docs/` for the full picture.

## Module layering (dependency rule — keep it clean for parallel work)

Dependencies point DOWNWARD only; this keeps merge collisions low and lets the
pure layers ship to the frontend:

- **stdlib / pure helpers** (`src/stdlib`, and `src/utils/{ip,subnet,geo,balancer,retry,load,template,envelope}`)
  — no server or heavy deps; **frontend-shippable**. Must NOT import services or
  anything that pulls in the mongo driver / ioredis.
- **node helpers** (`src/utils/{dns-cache,tls-fingerprint,ja3,useragent}`) —
  node built-ins / browser-data libs; server-side, still no mongo/redis.
- **services** (`src/services/*`) — may import server/network deps (store→mongo,
  cache→redis, rdap→rdap server, crtsh→http). The only layer allowed to.
- **blocks / sources** (`src/blocks/<one-folder-each>`, `src/sources/*`) — use
  services; each block is its own folder so contributors never collide.
- **engine** (`src/engine`) — orchestrates: store + registered block handlers.

A guard test (`src/stdlib/__tests__`) fails if stdlib transitively loads a
server-only dep.

## Always use the implement-js skill

**Before writing or editing any JavaScript in this repo, invoke the
`/implement-js` skill.** All house conventions (tabs + double quotes, CommonJS,
promise chains over async/await, functional style, service-object pattern,
module-per-folder with `index.js`, `queue-promised` for rate limiting, etc.)
come from there and are considered binding for this codebase.

## Layout

- `src/config` — env-backed config.
- `src/utils/*` — spec/plumbing + reusable helpers: `envelope`, `load`,
  `balancer`, `ip` (address framework incl. `random`/`randomFrom`), `subnet`,
  `geo`, `retry`, `useragent`, `dns-cache`. Not app logic.
- `src/services/*` — anything talking to an external service (or the store);
  named by function: `store`, `cache`, `resolver`, `dns-picker`, `asn`, `rdap`,
  `ip-lookup`, `ip-country`.
- `src/blocks/*` — the block library (67 blocks, one folder each). Full catalog
  in `docs/BLOCKS.md`; the registry (`src/blocks/index.js`) is the source of truth.
- `src/sources/*` — input sources (ct-log, list, webhook, tick).
- `data/*` — bundled dataset stubs (see `docs/DATA_SOURCES.md`).
- `src/engine` — the deterministic executor (entity-state fixpoint, bounded
  concurrency, sift guards, provenance merge, lineage edges, execution journal).
- `bin/*.js` — entrypoints: `run.js` (`yarn flow`), `export.js`, `mcp.mjs`,
  `monitor.js`, `build-frontend.js`. Prod under `forever`, dev under `nodemon`.
- `docs/` — `ARCHITECTURE.md`, `FLOW_SPEC.md` (the contract), `BLOCK_CONTRACT.md`,
  `BLOCKS.md` (block catalog).
- `examples/flows/*.yaml` — canonical flows.

## Key decisions (keep in sync as they land)

- **Predicates** (`when:`, source `filter:`) are Mongo-style queries via `sift`.
- **Frontend**: `qrp` (dogfooded), bundled with esbuild. Flow-builder canvas
  built on qrp primitives; entity explorer uses qrp's `table`/`collection`.
- **Per-item lifecycle**: XState is the candidate (serializable actors for
  restart-survival). Flow *topology* stays a DAG, not a state machine.
- **ESLint** is flat config (`eslint.config.js`) — v10 dropped `.eslintrc.json`.
- **Jest** transforms ESM-only deps (`uuid`, `sift`) via babel; app code is CJS.

## Commands

```bash
yarn flow    # load, validate, and RUN examples/flows/ct-recon.yaml (live)
yarn export  # run + serialize entities/provenance/edges/executions (JSON)
yarn mcp     # AI-facing MCP server (stdio)
yarn monitor # re-run a flow on a cron (MONITOR_CRON) — watch over time
yarn playbooks # run every ACTIVE playbook on a cron (draft/active/paused)
yarn test    # jest
yarn lint    # eslint (flat config)
```

## Block/source catalog

`docs/BLOCKS.md` is the human-facing catalog of every block and source (grouped,
with input/output + scenarios). **Adding a block or source means adding its row
there** — the registry (`src/blocks`, `src/sources`) stays the machine source of
truth (MCP `list_blocks` + the builder palette derive from it), but the doc must
be kept in sync by hand.

## Cleanup time checklist

`/implement-js` · update `README.md` · update `docs/BLOCKS.md` (any new
blocks/sources) · update this file · fill missing JSDoc · check tests · check
linter.
