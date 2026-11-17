# Issue #263 frontend evidence

Read-only screenshots and browser measurements from 2026-11-17. `production/` is `https://www.arcyusdc.xyz/`; `preview/` is the Vercel deployment of commit `c08cdeb6d0d978879053fb2f21e2f484324cc9b0`. The protected preview was opened with a temporary Vercel share link; the token is not stored here.

Each directory contains full-page `home-{320,390,800,1024,1440}.png` screenshots and `results.json`. Capture command: `node test/frontend-issue263-qa.cjs` with `ARCY_QA_BASE`, `ARCY_QA_OUT`, and three mobile runs. The script uses Playwright Chromium 1.56.1, 390 px mobile viewport, 4x CPU slowdown, 1.6 Mbps downstream and 750 ms RTT for LCP/CLS. Each run starts in a cold browser context. This is a lab sample, not field performance or proof of live API correctness.

| Check | Production | PR preview |
| --- | ---: | ---: |
| Horizontal overflow, all five widths | 0 px | 0 px |
| Browser page errors, all five widths | 0 | 0 |
| Mobile menu target, 390 px | 38 × 37 px | 44 × 44 px |
| Network tab height, 390 px | 40 px | 44 px |
| Unlocks pager target, 390 px | 27 × 30 px; unnamed | 44 × 44 px; named |
| Median mobile LCP, three runs | 5,844 ms | 6,504 ms |
| CLS, three runs | 0.0735 | 0.0735 |

The remote preview was **660 ms slower** in this three-run sample. An earlier Production sample under the same emulation had a 2,952 ms median, so the network and deployment path show substantial variance. Do not claim a speed improvement from these numbers. The paired local Lighthouse CI test is the performance regression gate. The preview samples also include Vercel preview access, while Production does not.

Browser functional tests use mocked API fixtures; the captures show the live page but do not verify on-chain data. No backend or Production configuration changed.
