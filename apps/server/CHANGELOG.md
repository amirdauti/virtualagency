## [1.6.0](https://github.com/amirdauti/virtualagency/compare/v1.5.2...v1.6.0) (2026-02-24)

### Features

* **server:** add Nango OAuth flow with tenant-scoped agent access ([11b02a4](https://github.com/amirdauti/virtualagency/commit/11b02a4e6f12d99a2f6ca7ec19fc742383f9af30))

### Bug Fixes

* allow larger hosted image payloads and return explicit 413 ([653f995](https://github.com/amirdauti/virtualagency/commit/653f995a8908d416187c30902369a26327636ae7))
* **billing-api:** avoid forcing hosted server restart in upgrade script ([69139ad](https://github.com/amirdauti/virtualagency/commit/69139ad7813277f61de29a4b6bc3484a299dd13f))
* **server:** normalize publish share URLs without trailing slash ([03821a9](https://github.com/amirdauti/virtualagency/commit/03821a9888f1631c5fbed34ecc45f6be3e074c2e))
* **server:** persist publish mappings and add public proxy diagnostics ([088bd55](https://github.com/amirdauti/virtualagency/commit/088bd557771d049079221b4d7ce21e31cb22905a))

## [1.5.2](https://github.com/amirdauti/virtualagency/compare/v1.5.1...v1.5.2) (2026-02-23)

### Bug Fixes

* **chat:** persist and replay user messages across refresh ([08e3e3f](https://github.com/amirdauti/virtualagency/commit/08e3e3ffce963aed42a833ce00ff005140b0af00))

## [1.5.1](https://github.com/amirdauti/virtualagency/compare/v1.5.0...v1.5.1) (2026-02-23)

### Bug Fixes

* **server:** persist hosted agents across restarts ([775047b](https://github.com/amirdauti/virtualagency/commit/775047b2139b3f962acb2e9260100fd3d1f144fd))

## [1.5.0](https://github.com/amirdauti/virtualagency/compare/v1.4.0...v1.5.0) (2026-02-22)

### Features

* **server:** add agent-tools scheduled tasks and server-side automation runner ([b069cc6](https://github.com/amirdauti/virtualagency/commit/b069cc62ab08368a08fb5f3a3e507a9ae060014e))

### Bug Fixes

* **hosting:** clear stale hosted server error after successful sync ([f8e3e5f](https://github.com/amirdauti/virtualagency/commit/f8e3e5fc01f4bd1384fdbf005a45ac113fc322cf))
* **hosting:** handle in-place rebuild sudo permission failures ([e356793](https://github.com/amirdauti/virtualagency/commit/e35679331bd284252a3845b8660b09c8e89454f7))

## [1.4.0](https://github.com/amirdauti/virtualagency/compare/v1.3.2...v1.4.0) (2026-02-21)

### Features

* **hosting:** add VPS watchdog timer to auto-restart VA runtime ([fd8d258](https://github.com/amirdauti/virtualagency/commit/fd8d2585f7ee9291fba26bd35e3fb837905768c8))
* **hosting:** make rebuild in-place via npm update and service restart ([bcf4478](https://github.com/amirdauti/virtualagency/commit/bcf44782c207e8f5a04e3a3a41b75d3a005b03dd))
* **hosting:** snapshot VPS before rebuild to prevent data loss ([bbd8846](https://github.com/amirdauti/virtualagency/commit/bbd88462fa7724b58c32d84a15a8d305623d98bb))

### Bug Fixes

* **desktop:** preserve hosted agent runtime after refresh ([c7c31c7](https://github.com/amirdauti/virtualagency/commit/c7c31c7a232706e35ba653837de6003b17b384f7))
* **hosting:** harden hosted auth bootstrap and runtime proxy timeouts ([ca3754d](https://github.com/amirdauti/virtualagency/commit/ca3754dbcb3d975651443fca2caa8c17a77ba840))
* **hosting:** make codex device code extraction more robust ([665970c](https://github.com/amirdauti/virtualagency/commit/665970c5830cb541fdedc8b7391632fde3c57014))
* **hosting:** scan all codex code candidates in auth output ([f3b2016](https://github.com/amirdauti/virtualagency/commit/f3b20166d3f259380c033010cbfcb9152d7657e1))
* **web:** eliminate hosted auth provider race on app bootstrap ([e929650](https://github.com/amirdauti/virtualagency/commit/e92965089c103d484048c78c6ff8116b154bfe93))
* **web:** merge externally created hosted agents on workspace sync ([724c051](https://github.com/amirdauti/virtualagency/commit/724c051a9cdbba10029c1dfc4d1a29ef051b1d11))

## [1.3.2](https://github.com/amirdauti/virtualagency/compare/v1.3.1...v1.3.2) (2026-02-20)

### Bug Fixes

* **server:** mirror web progress to telegram and speed up voice transcribe ([ed3bdae](https://github.com/amirdauti/virtualagency/commit/ed3bdaec712ec1b1282f829fc96f9c7e4fd70580))

## [1.3.1](https://github.com/amirdauti/virtualagency/compare/v1.3.0...v1.3.1) (2026-02-19)

### Bug Fixes

* **hosted:** run codex device auth via hosted runtime instead of SSH ([a916eac](https://github.com/amirdauti/virtualagency/commit/a916eacff6f22b353ce1a661f913334477148c2d))
* **hosting:** tighten codex device code extraction ([856b69b](https://github.com/amirdauti/virtualagency/commit/856b69b441644aa0da78b44017e1d7fd84c432ec))
* **server:** improve telegram codex progress and file-change snippets ([f111140](https://github.com/amirdauti/virtualagency/commit/f11114045a0bec1e004845535ce88820104f47a4))
* **ui:** keep hosted codex auth action clickable with backend error feedback ([9f4e2ee](https://github.com/amirdauti/virtualagency/commit/9f4e2eee304d036b651aa336c01f2e1bf7ac3b7a))

## [1.3.0](https://github.com/amirdauti/virtualagency/compare/v1.2.0...v1.3.0) (2026-02-19)

### Features

* **hosting:** automate codex device auth setup for hosted VPS ([2ee16b2](https://github.com/amirdauti/virtualagency/commit/2ee16b27720a19c8188e24f8f234fdac481c01c5))

### Bug Fixes

* **deploy:** proxy hosting api routes in nginx setup ([157c996](https://github.com/amirdauti/virtualagency/commit/157c996e5642ee4c109a4dac144dccfcab57e8d0))
* **hosting:** escape SSH_PUB in cloud-init bootstrap payload ([08e08e2](https://github.com/amirdauti/virtualagency/commit/08e08e2feb0c1f4afda89d01c8272d373a1599b2))
* **hosting:** restore hosted proxy connectivity and improve telegram progress ([e7ac180](https://github.com/amirdauti/virtualagency/commit/e7ac1801f1526af3de2755aa0760e786e267a87c))

## [1.2.0](https://github.com/amirdauti/virtualagency/compare/v1.1.1...v1.2.0) (2026-02-19)

### Features

* ship cloud agents control plane, hosted auth, and telegram streaming updates ([04c719b](https://github.com/amirdauti/virtualagency/commit/04c719b4fcd050cc3b015e16195d757ae316f588))

## [1.1.1](https://github.com/amirdauti/virtualagency/compare/v1.1.0...v1.1.1) (2026-02-19)

### Bug Fixes

* **server:** allow PUT preflight for telegram settings ([c9eb3b3](https://github.com/amirdauti/virtualagency/commit/c9eb3b3a435a07826ec24f2103daec35eb1c670d))

## [1.1.0](https://github.com/amirdauti/virtualagency/compare/v1.0.1...v1.1.0) (2026-02-19)

### Features

* **server:** add persistent telegram agent routing ([1f5e6ff](https://github.com/amirdauti/virtualagency/commit/1f5e6ff5c94086cc27bafe439df2e8c1a7d42a26))

## [1.0.1](https://github.com/amirdauti/virtualagency/compare/v1.0.0...v1.0.1) (2026-02-19)

### Bug Fixes

* **ci:** drop unavailable macos-13 runner from server release ([35cb30d](https://github.com/amirdauti/virtualagency/commit/35cb30de82a7b891d5aed7cc7e4e5cdc2500c7ba))
* **ci:** publish server package with multi-platform binaries ([d65a198](https://github.com/amirdauti/virtualagency/commit/d65a198e3089e1456a02029609fc4e1a97ac8b43))

## 1.0.0 (2026-02-19)

### Features

* **server:** add npm trusted publisher release workflow ([87371fc](https://github.com/amirdauti/virtualagency/commit/87371fcc44816a6f109702c726085f16fca4780f))
* **server:** document wrapper version flag ([53328c4](https://github.com/amirdauti/virtualagency/commit/53328c4ec58e2a78199588be7e7abf74b5ebbd4c))

### Bug Fixes

* **ci:** add manual dispatch to server release workflow ([2606591](https://github.com/amirdauti/virtualagency/commit/2606591cdeb3f016bed189af5374bc028da3ca60))
* **ci:** use npm cache config for server release workflow ([898e1f2](https://github.com/amirdauti/virtualagency/commit/898e1f2f396c0b6b2a8fd3723b4408bb524002e3))
* **ci:** use npm install for server release workflow ([17fe46f](https://github.com/amirdauti/virtualagency/commit/17fe46f1f7f61361dcd92782d7b6860f2c1ceb9f))
* **server:** add trusted publisher note to README ([428fb82](https://github.com/amirdauti/virtualagency/commit/428fb824dc4a5ebd4b3ed0a9d84cab62aeba1ddd))

# Changelog

All notable changes to `@virtualagency/server` are documented in this file.
