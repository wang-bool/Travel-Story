# Visible Agent operations

User requests MCP edits to feel like operating the visible app, rather than silent background writes. This extends the approved browser/MCP synchronization design; no new Agent or embedded UI.

## Behavior
Create, update, edit itinerary and calculate routes default to automatic browser presentation. Reuse a unique matching plan page (prefer focused/visible); open a correlated plan page if none exists. Multiple ambiguous pages require an explicit presentation.viewId. presentation.mode=none opts into background work. Delete does not open a deleted trip.

Data commits remain transactional and independent of browser availability. A browser failure must not turn a successful save into a retryable data failure. Return presentation status/command ID separately, never claim visible execution without page acknowledgement. Same mutation request retry deduplicates data and delivery within the running service.

The page receives a present_change command with minimum revision, action message, changed stop/day and added stop IDs. Refresh authoritative state even when cached revision matches, await React commit, then select, scroll, highlight and move camera. Metadata edits preserve camera. Notice remains visible briefly; reduced motion supported. Heartbeat revision comparison recovers missed SSE, including deletion. Page-map readiness, expiry and error reporting continue to apply.

No fake cursor or screen-coordinate clicking. The actual page executes its map/selection operations. A batch still commits atomically; its display summarizes the batch and focuses the final surviving target.

## Verification
Presenter queue/ack, auto-open and source correlation, stale revision barrier, background opt-out, ambiguous pages, mutation/display failure isolation, idempotent retry, real browser with SSE intentionally disabled, actual MCP add_stop via deterministic provider fixture, camera/selection/highlight/notice and receipt.
