# Data sources

External datasets the toolkit depends on. Bundled files under `data/` are
**small stubs** so the code runs and tests pass offline; production points the
relevant config path at a full checkout.

| Dataset | Used by | Bundled stub | Production source |
| --- | --- | --- | --- |
| Country → IP CIDR blocks | `services/ip-country` | `data/rir-ip-sample/` | [ipverse/country-ip-blocks](https://github.com/ipverse/country-ip-blocks) preprocessed to `<cc>/aggregated.json` (`{ country_code, prefixes: { ipv4, ipv6 } }`); set `COUNTRY_IP_PATH` |
| Country centroids | `utils/geo` | `data/combined-data.json` | full country-centroid table (lat/long per ISO code) |
| Public DNS resolvers (v4) | `services/resolver` | `data/valid-dns-servers.json` | curated resolver list |
| Public DNS resolvers (v6) | `services/dns-picker` | `data/valid-dns-v6-servers.json` | curated resolver list |
| Real user agents | `utils/useragent` | — (npm: `random-useragent`, `top-user-agents`) | shipped in the packages |
| ASN / prefix | `services/asn` | — (live: Team Cymru whois) | `whois.cymru.com:43` |
| RDAP / whois | `services/rdap` | — (live) | `node-rdap-lacnic` (ESM; **install to enable** — loaded lazily via `utils/load`) |

## Notes

- `services/ip-country` loads its dataset lazily and tolerates a missing path
  (returns `false`), so a full checkout is optional for development.
- `services/rdap` requires an external cache (Redis) for polite reuse, but falls
  back to the in-memory `services/cache` when `REDIS_URL` is unset.
