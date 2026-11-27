# Separate production secret-removal review

**Prepared only. No variable value was retrieved or configuration changed.**

| Item | Verified by name/config/code |
|---|---|
| Project | `8ba19c51-0434-44ee-b61c-8eddcd3bb941` |
| Environment | `ebdf4579-5ca8-45b0-b37e-fd67b1875279` |
| Old service | `arcy-holder-durable`, `5503b7a6-d6d3-43a7-9645-86b4429d58c7` |
| Variable | `RADAR_GITHUB_DISPATCH_TOKEN` is present by name |
| Intended owner service | `arcy-radar-scheduler`, `609b13bc-fe54-4b4a-b78d-e56cd41f3e5d`, has its own variable of the same name |
| Shared variables | None in the inspected environment |
| Holder dependency | No tracked Holder source reference; its Docker image does not copy the dispatcher |

`git grep -l RADAR_GITHUB_DISPATCH_TOKEN` finds only the Radar dispatcher,
Radar documentation/evidence and its tests. `Dockerfile.holder-worker` starts
only the export/Holder worker path. This establishes no code dependency; it
does not authorize production mutation or inspection of any secret value.

After separate explicit authorization, an operator can remove **only that named
variable** from the old service's Variables UI, without revealing/copying it.
Do not delete the scheduler's own variable, a shared signing/queue key, the
Holder volume, checkpoints or any other setting. Confirm the scheduler has
approved repository Actions read/write access first. Secret rotation belongs
in the private credential UI; no value should enter chat, source or artifacts.

Removal may cause a Railway configuration rollout/restart. Approval must cover
that production effect as well; do not silently restart or deploy Holder. Record
the name-only before/after state and verify unaffected Holder health and
scheduler execution after the authorized operation.

Required authorization comes directly from the user: “Do not merge, deploy or
modify production configuration without explicit authorization.” This PR
prepares a reviewable removal plan and performs none of those actions.
