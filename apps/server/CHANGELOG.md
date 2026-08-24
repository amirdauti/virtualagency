## [1.12.1](https://github.com/amirdauti/virtualagency/compare/v1.12.0...v1.12.1) (2026-08-24)

### Bug Fixes

* **server:** mirror completed Codex messages to Telegram ([2ec28cd](https://github.com/amirdauti/virtualagency/commit/2ec28cdba152ef24d565800d3f9837d3060d4f9e))

## [1.12.0](https://github.com/amirdauti/virtualagency/compare/v1.11.1...v1.12.0) (2026-08-24)

### Features

* **server:** manage Codex CLI and add GPT-5.6 models ([83250fb](https://github.com/amirdauti/virtualagency/commit/83250fb3dba2ceabb8be1e70d75dbd3289139c8a))

## [1.11.1](https://github.com/amirdauti/virtualagency/compare/v1.11.0...v1.11.1) (2026-07-15)

### Bug Fixes

* **server:** route hosted nango integration endpoints ([47eb60d](https://github.com/amirdauti/virtualagency/commit/47eb60d34f6edaaf53939d711636566d6a7d9e66))

## [1.11.0](https://github.com/amirdauti/virtualagency/compare/v1.10.1...v1.11.0) (2026-06-02)

### Features

* harden codex gpt-5.5 rollout ([aa86d8e](https://github.com/amirdauti/virtualagency/commit/aa86d8ef013649a265e15735b1ff4087122610a8))

## [1.10.1](https://github.com/amirdauti/virtualagency/compare/v1.10.0...v1.10.1) (2026-04-13)

### Bug Fixes

* auto-route ga4 google nango proxy requests ([81796c9](https://github.com/amirdauti/virtualagency/commit/81796c96057ededce3c7dcbb4445e5cc41af5b5a))

## [1.10.0](https://github.com/amirdauti/virtualagency/compare/v1.9.0...v1.10.0) (2026-03-07)

### Features

* **server:** add GPT-5.4 model support and frontend deploy guard ([8c0cd84](https://github.com/amirdauti/virtualagency/commit/8c0cd84fcecb008f2b7d3e2543fa3a8a1c611a6e))

## [1.9.0](https://github.com/amirdauti/virtualagency/compare/v1.8.2...v1.9.0) (2026-03-02)

### Features

* add tiered cloud plans and dedicated cloud management UX ([dd88743](https://github.com/amirdauti/virtualagency/commit/dd88743006bae820089e7d67f7a9e2b7db30ca11))

## [1.8.2](https://github.com/amirdauti/virtualagency/compare/v1.8.1...v1.8.2) (2026-02-26)

### Bug Fixes

* **server:** correct Nango proxy headers and GET body handling ([186169e](https://github.com/amirdauti/virtualagency/commit/186169e9b9b5a3fad914f970c9b377fa397205dd))

## [1.8.1](https://github.com/amirdauti/virtualagency/compare/v1.8.0...v1.8.1) (2026-02-26)

### Bug Fixes

* enforce nginx upload size limit for hosted api deploys ([9dcc63a](https://github.com/amirdauti/virtualagency/commit/9dcc63a20af554fed43b1209484488f2a98e6b7d))
* **mobile:** improve chat composer visibility and spacing ([fc2ef95](https://github.com/amirdauti/virtualagency/commit/fc2ef950bf5fd53d8836d7e2b3ffbc3a73b912ea))
* **mobile:** keep chat composer usable by collapsing options ([695a9a6](https://github.com/amirdauti/virtualagency/commit/695a9a6b9a967c465c8bcf5fe7f57ee55589c169))
* **mobile:** move chat options into modal sheet ([14634e2](https://github.com/amirdauti/virtualagency/commit/14634e222d7fed2ff0c0c2c5dfc49d6326301f5a))
* route hosted nango agent-tools through control plane ([2c45a10](https://github.com/amirdauti/virtualagency/commit/2c45a10704556501104b0e0ce584d1fc16bfd653))
* **server:** trigger patch publish for hosted nango fallback ([6aea7ec](https://github.com/amirdauti/virtualagency/commit/6aea7ec031d6a91c5245a54d143d9e2437f64f93))

## [1.8.0](https://github.com/amirdauti/virtualagency/compare/v1.7.1...v1.8.0) (2026-02-26)

### Features

* add oauth connection management and agent list toggle ([a57f17c](https://github.com/amirdauti/virtualagency/commit/a57f17c28fa97088e7f37153c2b836d84d65ab97))
* **platform:** improve mobile UX and hosted nango integration flow ([e003650](https://github.com/amirdauti/virtualagency/commit/e0036504b0d3c2ffd32f56da6af8c08b6a1a817a))

### Bug Fixes

* **auth:** fail closed when clerk publishable key is missing ([323551a](https://github.com/amirdauti/virtualagency/commit/323551a424189ccaf00b6e2d9e289c8c9fa8b1b3))
* **billing-api:** make hosted rollout shell scripts newline-safe ([bf9a8b3](https://github.com/amirdauti/virtualagency/commit/bf9a8b36a1d1d661f5fa06e4ad36a7fb5ee3c2c1))
* **server:** improve Nango/Google control-plane hints for agents ([6a7f815](https://github.com/amirdauti/virtualagency/commit/6a7f8159ac9459c4fed7ef31c9ec26363ebf6652))

## [1.7.1](https://github.com/amirdauti/virtualagency/compare/v1.7.0...v1.7.1) (2026-02-25)

### Bug Fixes

* **billing:** refresh stale active subscription state from Stripe on /me ([e18afb5](https://github.com/amirdauti/virtualagency/commit/e18afb5c1f84a6b7cf22c26aca00e6318d5d917d))
* **hosting-proxy:** always degrade read_git upstream errors ([608f4b6](https://github.com/amirdauti/virtualagency/commit/608f4b609036a93d7df8af9d4af6d06ad9d557c0))
* **hosting-proxy:** return empty read_git content on proxy exceptions ([924cd2a](https://github.com/amirdauti/virtualagency/commit/924cd2a5051f1c2023910b554796b602e77b2841))
* **hosting-proxy:** suppress non-fatal read_git errors for hosted UI ([62162aa](https://github.com/amirdauti/virtualagency/commit/62162aabbd7bb3dc3669eb01cddc3046a99709f3))
* **server:** trigger semantic patch release for rollout validation ([2828034](https://github.com/amirdauti/virtualagency/commit/2828034606fcd12f935552910c19fe7fb463a957))
* **web:** allow hosted-active users through billing gate ([b7a2442](https://github.com/amirdauti/virtualagency/commit/b7a24422cd6eaac77ee4ea05760aa378aec9eb4e))
* **web:** use direct Vite env access for Clerk/billing runtime config ([99496ac](https://github.com/amirdauti/virtualagency/commit/99496ac53d619d6ce814ea91eeb240f3d2346a20))

## [1.7.0](https://github.com/amirdauti/virtualagency/compare/v1.6.1...v1.7.0) (2026-02-25)

### Features

* **server:** harden hosted auth flow and telegram chat-id security ([f3e77c1](https://github.com/amirdauti/virtualagency/commit/f3e77c102ebc1754983345af22ae319d9d561216))

### Bug Fixes

* **hosting:** fallback to va ssh upgrade before root ssh ([566da11](https://github.com/amirdauti/virtualagency/commit/566da1152989021ee211baa44336b1c6b1767e74))
* **hosting:** use ssh fallback when in-place rebuild times out ([9f44d4b](https://github.com/amirdauti/virtualagency/commit/9f44d4b862deed41f260230dc06ac41aa6b2ad9d))

## [1.6.1](https://github.com/amirdauti/virtualagency/compare/v1.6.0...v1.6.1) (2026-02-24)

### Bug Fixes

* **server:** add versioned health response and rollout ssh fallback ([4b1ad3c](https://github.com/amirdauti/virtualagency/commit/4b1ad3c812be7893b9d0488a4474382530a1ce65))

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
