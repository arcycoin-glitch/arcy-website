<p align="center">
  <img src="./search/assets/arcy-owl-reference.webp" width="156" alt="ARCY SEARCH owl" />
</p>

<h1 align="center">ARCY SEARCH</h1>

<p align="center">
  <strong>Research first. Hype never.</strong><br />
  Independent, evidence-first token intelligence across three EVM networks.
</p>

<p align="center">
  <a href="https://www.arcyusdc.xyz/">Live Platform</a> &nbsp;·&nbsp;
  <a href="https://www.arcyusdc.xyz/#search">Explore ARCY SEARCH</a> &nbsp;·&nbsp;
  <a href="https://www.arcyusdc.xyz/search/token/arc/0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b">Research ARCY</a>
</p>

---

### Built for verification, not hype

**ARCY SEARCH** is the research layer of the ARCY ecosystem: a public, read-only way to examine token contracts, separate verified evidence from unverified claims, and follow source references before making decisions.

A ticker or logo does **not** establish who issued a token. ARCY SEARCH treats the **network + full contract address** as the token's identity boundary.

| Network | Chain ID | Research scope |
| :-- | --: | :-- |
| **Arc** | `5042` | ERC-20 supply, burn-address balances, contract controls, available holder evidence |
| **Ethereum** | `1` | Contract identity, supply, holder evidence and supported security checks |
| **Robinhood Chain** | `4663` | Contract inspection, official asset-registry matches where supported, evidence-led analysis |

### What you'll find

| Research module | What it evaluates |
| :-- | :-- |
| **Supply & Burn** | On-chain total supply and balances at standard burn addresses; these are *not* proof of historical buybacks |
| **Holders** | Source-backed holder counts and concentration metrics only when adequate evidence is available |
| **Liquidity & Exit** | Pool/liquidity observations where permitted and verifiable; liquidity is *not* proof of LP locking |
| **Market Activity** | Market observations only when an approved data source is available |
| **Contract Mechanics** | Observable ownership, mint, tax and upgradeability signals without inferring unproven permissions |

The report schema contains **5 research cards and 20 checks**. Unsupported or unavailable fields are marked **NOT VERIFIED** rather than filled with assumed values.

### Product principles

- **Exact-contract evidence.** Network and full contract address must match; lookalike names are not enough.
- **Transparent uncertainty.** Missing information is not replaced with zero, estimates or an automatic safety score.
- **Read-only by design.** The research tool does not execute trades or request wallet signing.
- **Preserved context.** Source links, observed chain data and explicit limitations appear alongside results.
- **Mobile-first access.** Discover a token by name, ticker or contract, then open its dedicated research page.

### Live product

The website brings together ARCY's project identity and its research tools:

**[Open ARCY SEARCH →](https://www.arcyusdc.xyz/#search)**

The original ARCY site also includes its Burn dashboard, Unlocks, Arc Pulse, Research and Swap navigation.

> **Market data status:** Commercial-use permissions for some third-party market feeds are still being assessed. Live Beta preserves the 4H / 1D / 1W / 30D chart interface, but price candles and unsupported market metrics remain pending until an approved source is connected. This does not prevent on-chain contract research.

### Developer orientation

This is the public repository for the ARCY site and its Search research layer.

```text
/
├── index.html                 # ARCY landing page
├── search/                    # Token discovery and detailed research UI
│   └── server/                # Chain adapters and evidence validation
├── api/                       # Vercel API routes
├── scripts/                   # Maintenance and acceptance checks
└── test/                      # Automated tests
```

**Runtime:** Node.js 22+ · Vercel · JavaScript · EVM JSON-RPC

```bash
npm install
npm test
```

Browser acceptance and live-chain tests are available in `scripts/` and through the project's test commands. Real upstream RPC/provider calls may fail or be rate-limited; such failures must not be treated as successful verification.

### Security & transparency

If you find a security issue, **do not publish credentials, private keys or exploit details in a public issue**. Contact the project maintainers through an appropriate private channel.

This software is an independent research tool, **not financial advice**. Contract matching does not verify an issuer's solvency, token price, economic safety or suitability for investment. ARCY SEARCH is not affiliated with, endorsed by or officially connected to Robinhood Markets, Inc.

---

<p align="center">
  <strong>ARCY — Research First. Hype Never.</strong><br />
  <a href="https://www.arcyusdc.xyz/">arcyusdc.xyz</a>
</p>
