# UI review 2026-11-21 — Radar search, Token Unlocks mobile, Holder & Whale / Contract & Mechanics summaries

Captured with `test/ui-screenshots-cdp.cjs` (headless Chrome, 390 px unless named otherwise).
- **Radar:** the real Production `served/*.json` responses from 2026-11-21 08:19 UTC.
- **Unlocks and research cards:** controlled fixtures, not live evidence.

| File | Shows |
|---|---|
| unlocks-320 / unlocks-390 | Before: 690 px table, amount and % hidden off-screen. After: one compact record per unlock, nothing hidden |
| radar-search-390 | Search "fobo" → 1 result in Robinhood; the other 9 rows hidden in place, order and scores unchanged |
| radar-search-empty-390 | No-result state with the scope explanation |
| holders-390 | Added Turkish summary: holder count, concentration bars, address roles, block / source / evidence link |
| mechanics-390 | Added Turkish summary: CONFIRMED / NOT DETECTED / NOT VERIFIED per mechanic; taxes, mint, owner, proxy, pause, architecture |

Measured with no horizontal page overflow at 320 / 360 / 390 / 412 / 768 / 1280 / 1440 px. The Unlocks table no longer scrolls at 768 px (before: 720 px inside a 707 px box).
