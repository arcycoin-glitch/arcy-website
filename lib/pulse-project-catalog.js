'use strict';

// Editorial review binds a project, a chain-specific claim, a date and an exact primary URL.
// Rechecking the page verifies the publication, while its deployment and usage claims stay attributed.
const AAVE = { id: 'aave', name: 'Aave', purpose: 'Builds lending markets for borrowing against crypto collateral.',
  profileImplication: 'Markets can set different collateral and borrowing terms for different assets.',
  identityUrl: 'https://www.aave.com/docs/resources/changelog' };
const MORPHO = { id: 'morpho', name: 'Morpho', purpose: 'Builds isolated lending markets and tools for matching credit offers.',
  profileImplication: 'Separate markets allow collateral and loan terms to be evaluated individually.',
  identityUrl: 'https://morpho.org/what-is-morpho' };
const UNISWAP = { id: 'uniswap', name: 'Uniswap', purpose: 'Builds onchain exchange pools and swap routing tools.',
  profileImplication: 'Liquidity pools let apps quote trades directly against pooled assets.',
  identityUrl: 'https://docs.uniswap.org/' };
const CHAINLINK = { id: 'chainlink', name: 'Chainlink', purpose: 'Builds price oracles and cross-chain messaging for smart contracts.',
  profileImplication: 'Lending apps can use published oracle prices to value supported collateral.',
  identityUrl: 'https://docs.robinhood.com/chain/' };

const aave = { url: 'https://governance.aave.com/t/al-development-update-october-2026/25979', publisher: 'Aave Labs',
  date: '2026-11-02', title: 'AL Development Update | October 2026', discourseAuthor: 'AaveLabs' };
const morpho = { url: 'https://morpho.org/blog/the-morpho-effect-october-2026', publisher: 'Morpho',
  date: '2026-11-05', title: 'Morpho Effect October 2026' };
const hooks = { url: 'https://blog.uniswap.org/aggregator-hooks-are-now-live', publisher: 'Uniswap Labs',
  date: '2026-10-22', title: 'Aggregator Hooks Are Now Live', marker: 'Ethereum mainnet, Base, and Robinhood Chain' };
const loanAssets = 'P2P Orders, available on Base, Ethereum, Arc and Robinhood Chain';

const PROJECTS = {
  arc: [
    { ...AAVE, limitation: 'Current caps, borrow costs and liquidity have not been independently checked.', developments: [{ ...aave,
      marker: 'Onboarded syrupUSDC to Aave V4 on Arc', change: 'Aave Labs reported adding syrupUSDC collateral to its Arc Maple Spoke.',
      implication: 'Eligible suppliers can use syrupUSDC to borrow USDC in that market.' }] },
    { ...MORPHO, limitation: 'Available offers, fill rates and executable depth on Arc are unknown.', developments: [{ ...morpho,
      marker: loanAssets, change: 'Morpho reported that Arc peer-to-peer orders can now specify any network token as the loan asset.',
      implication: 'Lenders can make offers beyond the assets listed in existing markets.' }] },
    { ...UNISWAP, limitation: 'The launch announcement does not establish current pool depth or exit costs.', developments: [{
      url: 'https://blog.uniswap.org/uniswap-is-live-on-arc', publisher: 'Uniswap Labs', date: '2026-09-16',
      title: 'Uniswap Is Live on Arc', marker: 'Uniswap v2, v3, v4 and UniswapX are live on Arc',
      change: 'Uniswap Labs announced Arc support for its pools, web app, wallet and API.',
      implication: 'Arc apps can use the same swap interfaces for supported Arc assets.' }] },
  ],
  ethereum: [
    { ...AAVE, limitation: 'Collateral concentration and liquidation performance in these markets remain unverified.', developments: [{ ...aave,
      marker: 'Sentora operate a dedicated Hub and Spokes on Ethereum', change: 'Aave Labs reported three new Ethereum markets curated by Sentora.',
      implication: 'Borrowers gain additional stablecoin and collateral combinations under a separate risk manager.' }] },
    { ...MORPHO, limitation: 'The update does not establish that a given asset has lenders or fillable offers.', developments: [{ ...morpho,
      marker: loanAssets, change: 'Morpho reported broader loan-asset support for Ethereum peer-to-peer orders.',
      implication: 'A borrower can seek a loan asset outside existing markets if a lender makes an offer.' }] },
    { ...UNISWAP, limitation: 'Quoted execution and depth still vary by trade size and available routes.', developments: [{ ...hooks,
      change: 'Uniswap Labs reported enabling Aggregator Hooks for Ethereum swaps in its app and API.',
      implication: 'Routes can combine Uniswap pools with supported external liquidity.' }] },
  ],
  robinhood: [
    { ...MORPHO, limitation: 'Market caps, oracle configuration and liquidation depth need a separate check.', developments: [{ ...morpho,
      marker: 'Any user on Robinhood Chain can now use their Stock Tokens as collateral on Morpho',
      change: 'Morpho reported that Robinhood Stock Tokens can be used to borrow stablecoins on Robinhood Chain.',
      implication: 'Eligible holders may raise stablecoin liquidity without selling the collateral first.' }] },
    { ...UNISWAP, limitation: 'The report does not establish depth or execution quality for any individual stock token.', developments: [{ ...hooks,
      change: 'Uniswap Labs reported enabling Aggregator Hooks for Robinhood Chain swaps.',
      implication: 'The app and API can quote supported external liquidity alongside Uniswap pools.' }] },
    { ...CHAINLINK, limitation: 'Feed freshness and coverage for a specific token require checking that feed directly.', developments: [{
      url: 'https://www.prnewswire.com/news-releases/robinhood-chain-launches-and-adopts-chainlink-to-unlock-access-to-the-onchain-economy-for-millions-of-users-302816242.html',
      publisher: 'Chainlink announcement via PR Newswire', date: '2026-07-01', title: 'Robinhood Chain Launches and Adopts Chainlink', marker: 'Data Streams',
      change: 'Chainlink announced oracle and cross-chain support at Robinhood Chain mainnet launch.',
      implication: 'Apps can integrate published feeds for supported assets, including stock tokens.' }] },
  ],
};

module.exports = { PROJECTS };
