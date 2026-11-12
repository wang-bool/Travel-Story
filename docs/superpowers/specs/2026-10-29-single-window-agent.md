# Single-window Agent control

Approved by user: keep one application window and navigate inside it. Browser development and future installed desktop application share MCP tools, business actions, in-app navigation and page receipts.

## Architecture
Root layout mounts one persistent AppAgentBridge. It owns a stable window/view ID, lease, heartbeat, serialized command queue and receipts across client-side routes. Plan/play useAgentView hooks publish page capabilities and handlers to the root bridge instead of opening their own connections. Home and record remain navigable without registering a map handler.

View page values: home, plan, play, record, unknown. tripId optional outside trip routes. New internal navigate command has a validated business target (tripId, page plan/play, optional dayId/stopId/revision), never arbitrary URL. Navigate is allowed while current map is loading/failed; other page commands require compatible ready page. Route changes preserve pending/running navigate commands but expire stale page commands.

App navigator chooses explicit viewId, otherwise focused/visible unique window, then unique matching destination/unique connected window; ambiguity fails. Existing connected window always receives internal navigation, not an OS browser launch. No connected window uses an injected ApplicationLauncher (current implementation opens browser); concurrent startup is coalesced for same target and blocked for conflicting target, preventing duplicate launch storms.

Client AppHost.reveal boundary uses best-effort browser focus today and a narrow injectable desktop revealWindow capability later. Framework router handles navigation in both hosts. No installer/Electron implementation this iteration.

Navigation receipt completes only after target route is mounted, required trip revision synchronized, target page/map ready and requested selection applied. The same view ID survives transitions. Root continues heartbeat while a navigation command is waiting; page handlers are matched by route and registration identity. Expiry or manual navigation away cancels stale work rather than issuing false success. Native launch receipts still correlate by launch ID.

Mutation presentation routes through this same navigator then presents the saved change. Existing matched ready page can present directly; different trip/page reuses chosen root window. Background mode and data/display failure isolation remain unchanged. Explicit open_trip may accept viewId.

## Validation
Pure runtime/root registration tests, registry route transition/expiry, unsafe navigation rejection, focused window choice, open reuse/coalescing, homepage→plan, plan A→plan B, play→plan, metadata/focus/camera, actual MCP editing, stable window ID and no extra OS launches when a page is connected. Full tests, typecheck, isolated production build, real SDK+Chrome fixtures. Leave local v2 working tree, no push.
