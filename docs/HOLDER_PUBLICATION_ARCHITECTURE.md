# Holder publication and independent Search delivery

Initial `/api/holders?address=...` reads only bundled public COMPLETE snapshot JSON.
It never contacts Redis, Railway, RPC, discovery or the queue. Missing publications
return NOT VERIFIED immediately. The four other cards retain independent requests.
Liquidity uses `summary=1` for its initial market numbers; LP custody analysis runs
as a separate request and retains the existing verification engine.

The browser independently requests `action=queue` and `action=published` on the
existing Holder function. Neither contributes to initial scan completion. Newer
publications may replace displayed data only if COMPLETE and at an equal/newer
pinned block. No partial metrics are published.

## Worker storage

Use one Railway replica with a persistent volume. Set `ARC_HOLDER_STORAGE=local`
and `ARC_INDEX_CACHE_DIR` to its mounted checkpoint directory. This explicitly
ignores optional Redis configuration. Existing atomic file checkpoint/queue logic
is reused; no request-time history reconstruction is reintroduced. Back up the
volume. Multiple worker replicas need shared transactional storage and are not
supported by this single-writer file configuration.

Set `ARC_HOLDER_PUBLISHED_DIR` to a separate directory on that volume. Worker
publication reads the fully reconciled stored snapshot, then replaces a small
publication file atomically. BUILDING/failure never replaces a COMPLETE file.
`scripts/export-holder-snapshots.cjs <checkpoint-directory>` exports existing
verified COMPLETE documents without enumerating history again.

## Separate background delivery

The worker can expose its HTTP listener using Railway's `PORT`:

- Authenticated POST `/queue`: exact chain 5042/contract, bounded deduplicated queue.
- Public GET `/snapshots/<contract>.json`: signed COMPLETE publications only.

Configure the same private `ARC_HOLDER_QUEUE_TOKEN` on worker and Vercel and
`ARC_HOLDER_QUEUE_URL` on Vercel pointing to the worker's HTTPS `/queue` endpoint.
Use an Ed25519 private `ARC_HOLDER_SIGNING_KEY` only on the worker, and its public
`ARC_HOLDER_PUBLIC_KEY` on Vercel. `ARC_HOLDER_PUBLISHED_URL` points to the HTTPS
snapshot directory, optionally through a CDN. No credential is sent to browsers.
Remote snapshots without a valid signature are rejected.

Bundled historical publications remain available when that background service,
CDN or Redis fails. Configuring no background endpoint is reported as
BACKGROUND_QUEUE_NOT_CONFIGURED, never as successful queue insertion. Existing
publications remain explicitly historical; they are not advertised as live.

## Current migration state

Seven prior audited COMPLETE snapshots were recovered from local durable audit
documents. Full balance reconciliation was revalidated and their recorded block
anchors checked against Arc Mainnet before export. No fabricated replacement
values or token-specific application branches were added.

The validated durable Railway service reuses its persistent checkpoint/publication
volume and one non-root worker process. Its production image contains no acceptance
diagnostics or checkpoint seeds. On restart it republishes only fully reconciled
stored COMPLETE snapshots, then resumes the existing durable queue. Vercel uses the
authenticated queue URL, signed publication URL and public verification key; the
private signing key remains on Railway. Bundled publications are independently
available when Railway is unreachable.

Upstash is neither used nor upgraded by this architecture. Existing Redis
checkpoints have not been deleted. While Redis is suspended, any more recent
checkpoint stored only there cannot be recovered; retained audited checkpoints
remain historical evidence rather than being presented as continuously live data.
