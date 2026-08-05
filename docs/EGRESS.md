# Egress & anti-fingerprinting

Outward recon requests (title grabs, wappalyzer, crt.sh, generic HTTP blocks)
must look like real browser traffic or they get blocked at the CDN/bot-wall
layer. Three independent layers, composed:

1. **User agent** — `utils/useragent`: coverage-weighted real UA strings.
2. **Source IP** — `utils/random-ip`: rotate egress across owned ranges (v4/v6).
3. **TLS fingerprint (JA3)** — `utils/tls-fingerprint`: shape the client hello.

The three must **agree**: a Chrome UA behind a Firefox-ordered JA3 from a random
IP is itself a tell. Pick a browser, then take its UA and its TLS profile
together (`tlsFingerprint.forUserAgent(ua)`).

## TLS fingerprint: spoof real browsers, don't randomise

The goal is to match an **existing** browser's JA3, not to invent a novel one (a
random JA3 under a Chrome UA is suspicious). Node limits us: it can order the
TLS 1.3 ciphers (which shifts the JA3 toward a target browser) but cannot
reorder TLS extensions, so the match is close, not exact.

- **Now (zero native deps):** `utils/tls-fingerprint` orders ciphers to match
  `chrome` / `firefox` and preserves Node's security exclusions. Beats
  blocklist-based blocking (Akamai/Cloudflare bot walls). Pairs with the UA
  layer.
- **Escalation (exact JA3):** [bogdanfinn/tls-client](https://github.com/bogdanfinn/tls-client)
  (Go + uTLS) as a sidecar for perfect impersonation including extension order.
  Use when a target blocklists by exact JA3 and cipher ordering isn't enough.
  Needs a Go shared lib + FFI bindings — heavier, network-side.

## Verifying our own JA3 (built)

`utils/ja3` measures our actual outgoing fingerprint **offline**: a loopback TCP
server taps the raw ClientHello a `tls.connect` client sends, and JA3 is
computed with [`read-tls-client-hello`](https://www.npmjs.com/package/read-tls-client-hello)
(no hand-rolled parser, GREASE handled). No external service, no completed
handshake.

Measured finding (proves the approach): the three profiles produce three
distinct JA3s, so Node's `ciphers` option genuinely moves the fingerprint —

| profile | JA3 |
| --- | --- |
| chrome | `8f52e022887766d648be498c53e0809e` |
| firefox | `07545dfd0e8a73ef737671af96a04d07` |
| node | `e29263fb066facf0f3d23ccaf0fe19da` |

These match *our* build of Node; to impersonate a real browser, calibrate
`utils/tls-fingerprint` profiles against that browser's published JA3 and assert
equality here. (Exact-match including extension order still needs the
`tls-client` escalation.)

## HTTP client layer (planned)

A `services/http` will centralise egress: given a target, pick a consistent
{UA, TLS profile, egress IP}, apply retries/timeouts, and route through the
above. Default transport is Node `https` with a shaped `Agent`; the `tls-client`
sidecar is a pluggable transport for hard targets.

Reference / inspiration for the impersonating client:
[`ghostfetch`](https://www.npmjs.com/package/ghostfetch) (fetch-style browser
impersonation) and `tls-client`.
