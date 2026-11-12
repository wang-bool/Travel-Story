# Visible Agent operations implementation plan

**Goal:** MCP edits automatically present their results in the browser.
**Architecture:** Shared service commits, mutation presenter targets/opens a view, version-aware page executes presentation and acknowledges. Client heartbeat repairs dropped SSE.

- [x] Diagnose existing separation between data writes and explicit open/control tools.
- [x] Add failing tests for presenter delivery, correlation/readiness, opt-out, ambiguity and failure isolation.
- [x] Implement bounded presenter in lib/server/mutationPresentation.ts and strict present_change registry validation.
- [x] Extend MCP schemas and dispatcher with default presentation and independent result status; preserve data idempotency.
- [x] Implement client revision barrier, active-view heartbeat, fallback synchronization, card highlight, camera focus and notice.
- [x] Review spec and code quality; fix findings.
- [x] Run full tests, typecheck, isolated production build and actual SDK/browser integration.
- [x] Update usage documentation and preserve local v2 branch.

## Verified results

- 70 assertions pass in full npm test; npm run typecheck passes.
- Isolated production build passes.
- Real SDK/stdin transport and headless Chrome with deterministic geocoder/map fixtures: MCP add_stop automatically focuses the new stop, highlights card, shows message and receives page acknowledgment without extra presentation tools.
- Browser EventSource intentionally disabled: heartbeat plus authoritative revision barrier keeps updates visible.
- Metadata and automatic route refresh preserve camera; mixed stop/day batch presents final explicit day.
- No-view mutation requests correlated browser opening; test launcher navigates Chrome, then mutation receives real page acknowledgment. Native OS foreground policy is not asserted by this fixture.
- WebGL context loss reports failure and retry restores readiness. No runtime exceptions.
- Independent spec/quality review resolved camera framing and mixed-batch priority findings.
- Changes remain local on v2; no push.
