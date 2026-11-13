# Capacitor iOS app with share import: plan

Task spec: the pasted brief of 2026-11-13 (TestFlight build, offline, cold open under 1s, share-sheet import). Approved 2026-11-13.

| # | Item | State |
| --- | --- | --- |
| 0 | Verify on iOS 26.5 sim: module workers + wasm load over `capacitor://localhost`; a share extension can open its app | done: Best picks ranked in the sim; Photos > Share > Unsettled opened the app ("◀ Photos" back link) via responder-chain `open(_:options:completionHandler:)` |
| 1 | Native web build: `vite build --mode native` to `dist-native/`, `base: '/'`, VitePWA `disable: true` | done |
| 2 | Sandbox-file copy of `MAPS_KEY` and `WORKSPACE_KEY` (temp + rename, coalesced), restored in `main.tsx` before mount only when web storage lacks a key | done: 12 maps survived two `Library/WebKit` wipes; boot re-copies both keys unawaited |
| 3 | Share import: `ImportDialog` `importFile(file)` + `file` prop; `unsettled:share` window event; hosts in `Workspace` and `PhoneShell` (closes Maps); native listener feeds the event | done: PNG cold + warm, Update leaves one board, JPEG and HEIC import. Seen under XCUITest only: the first tap after a share-opened launch does nothing, the second works; not reproduced by hand |
| 4 | Share extension target (own `ShareViewController`, copies file to App Group, opens `unsettled://share`) | done |
| 5 | Export: native `downloadBoard` writes to Documents (visible in Files) then opens the share sheet (`@capacitor/share`; Capacitor has no WKDownload handling, so a blob link does nothing) | done: `endgame.catan.json` and library backup in Documents, share sheet opens |
| 6 | Cold open: launch screen and webview background `#efe8d9`, no splash delay; measure 5 runs, check frames for white | done: Release median 823 ms (791, 760, 949, 823, 874) at load 5.5; no frame brighter than the launch screen |
| 7 | npm scripts `ios:build`, `ios:archive` (timestamp build number), `ios:upload` (ExportOptions.plist); CLAUDE.md Commands | done: `ios/archive.sh` archives unsigned then signs ad hoc with each target's entitlements (automatic signing wants a development profile, refused to a team with no devices; export keeps only the archive's entitlements); `ExportOptions.plist` names the team |
| 8 | Playwright `e2e/shareImport.spec.ts` | done |
| 9 | Gates: typecheck, lint, test, test:e2e, build + test:pwa; sim offline check; storage wipe check; share checks (PNG, JPEG, HEIC, cold, warm, Update); export files | done: typecheck, lint, test, e2e 101, build + test:pwa 3; offline argued from bundle (sim has no own airplane mode) |
| 10 | Archive + upload to TestFlight | done: build 1.0 (20261113.1956) uploaded 2026-11-13, exported IPA checked for the App Group in both targets under Apple Distribution; App Store processing not yet confirmed |
