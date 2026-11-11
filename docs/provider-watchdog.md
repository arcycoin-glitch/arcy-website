# Provider Watchdog V1

The provider watchdog is a secret-free state machine used by the autonomous verification layer. It is intentionally not connected to live transports in this PR.

## States

| State | Ordinary traffic | Recovery probe | Meaning |
| --- | --- | --- | --- |
| `HEALTHY` | yes | no | normal provider |
| `DEGRADED` | yes | no | transient failures observed; caller may prefer a healthier provider |
| `COOLDOWN` | no | after cooldown | rate-limited provider |
| `UNAVAILABLE` | no | after cooldown | repeated transient failure, malformed response, or wrong chain |
| `PROBING` | no | yes | provider is recovering but is not trusted for ordinary traffic yet |

Two successful recovery probes are required before a provider returns to `HEALTHY`.

HTTP 429 uses the repository's existing deterministic refresh backoff, capped at 30 minutes for provider rotation. Wrong-chain and malformed-provider failures enter `UNAVAILABLE` immediately.

The state stores provider aliases only. Raw URLs, authorization headers, API keys, and arbitrary exception messages are deliberately outside the schema.
