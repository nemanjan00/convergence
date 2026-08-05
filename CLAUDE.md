# recon-flow — agent guide

Repeatable agentic recon: an AI composes a declarative YAML flow; a deterministic
runtime executes it. See `README.md` and `docs/` for the full picture.

## Always use the implement-js skill

**Before writing or editing any JavaScript in this repo, invoke the
`/implement-js` skill.** All house conventions (tabs + double quotes, CommonJS,
promise chains over async/await, functional style, service-object pattern,
module-per-folder with `index.js`, `queue-promised` for rate limiting, etc.)
come from there and are considered binding for this codebase.

## Layout

- `src/config` — env-backed config.
- `src/utils/*` — spec/plumbing + reusable helpers: `envelope`, `load`,
  `balancer`, `ip`, `subnet`, `geo`, `retry`, `random-ip`, `useragent`,
  `dns-cache`. Not app logic.
- `src/services/*` — anything talking to an external service (or the store);
  named by function: `store`, `cache`, `resolver`, `dns-picker`, `asn`, `rdap`,
  `ip-lookup`, `ip-country`.
- `src/blocks/*` — contract-conforming block handlers (`demo` today; real blocks
  will adapt the services above into the work-item/result envelope).
- `data/*` — bundled dataset stubs (see `docs/DATA_SOURCES.md`).
- `src/runtime` — the deterministic executor (bounded concurrency, sift guards,
  provenance merge).
- `bin/*.js` — entrypoints (`demo.js`). Prod runs under `forever`, dev under
  `nodemon` (`*-watch` scripts).
- `docs/` — `ARCHITECTURE.md`, `FLOW_SPEC.md` (the contract), `BLOCK_CONTRACT.md`.
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
yarn demo   # runnable proof: blocks -> one entity, provenanced
yarn test   # jest
yarn lint   # eslint (flat config)
```

## Cleanup time checklist

`/implement-js` · update `README.md` · update this file · fill missing JSDoc ·
check tests · check linter.
