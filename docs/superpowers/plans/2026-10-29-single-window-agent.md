# Single-window Agent implementation plan

**Goal:** MCP navigates and operates one persistent application window.
**Architecture:** App-level connection + route-specific registrations; server application navigator + host launch/reveal adapters; explicit navigation readiness receipts.

- [x] Write failing registry tests for home identity, navigation while unready, route transitions and stale page commands.
- [x] Implement application route parsing/path validation and server registry extensions.
- [x] Implement injected application navigator; test reuse, ambiguity, startup correlation/coalescing and receipts.
- [x] Replace leaf connections with root runtime/bridge and page registrations, test stable identity and handler readiness/cancellation.
- [x] Wire dispatcher/open_trip and mutation presentation into unified navigation.
- [x] Run independent spec then quality review, address findings.
- [x] Test actual single Chrome target through home/plan/play transitions and MCP edits with no extra launcher calls.
- [x] Complete full verification, update docs, preserve local v2 changes.

Verification: 83 unit/contract/runtime subtests passed; typecheck and isolated production build passed. Independent server/client reviews completed; fixed late launch expiry before readiness. Real SDK + Chrome exercised home→plan→play→plan→new trip with stable viewId and zero additional OS launch calls, actual MCP add-stop/highlight and manual edits, heartbeat without SSE, camera preservation and WebGL retry. Browser uses deterministic empty map tiles and disposable data. No installer implemented.
