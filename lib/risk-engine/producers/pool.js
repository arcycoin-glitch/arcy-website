'use strict';
// Reviewed pool producer v1 for `low-pool-liquidity` (risk.pool-liquidity) and `high-exit-impact` (risk.exit-impact).
//
// Scope: Ethereum Uniswap-V2-style pairs of the reviewed factories (lib/liquidity-exit-v2.js PROTOCOLS) against a quote
// asset that has a reviewed Chainlink USD feed. Arc and Robinhood have no reviewed USD anchor: no record, no RPC call.
//
// Per registered operator, all at ONE pinned block (lib/risk-engine/producers/operators.js):
//  1. USD anchor per quote asset: feed description(), decimals() == 8, latestRoundData() with answer > 0, answeredInRound
//     >= roundId and updatedAt within heartbeat + 30 min of the block; quote token decimals() as reviewed. A failed
//     check removes that quote asset (never a default price).
//  2. Candidate pools: reviewedFactory.getPair(token, quote). Identity: pair.factory() == that factory, token0/token1 are
//     exactly {token, quote}, balances >= reserves (no unsynced deficit), both reserves > 0.
//  3. Selected pool = the candidate with the most quote-side USD; ties keep table order. Both operators must select the
//     same pool from the same reads (it is part of the agreement signature).
//  4. Liquidity (usd-cent) = 2 x quote reserve x anchor. For a constant-product pair this is the pool value at its own
//     marginal price; raising it requires depositing real quote asset, so it is not inflatable by price alone.
//  5. Exit impact (bps): sell $1,000 of the token. amountIn = 1000 USD / (pool marginal price x anchor). Price impact is
//     the constant-product slippage EXCLUDING the reviewed pool fee (fee is reported separately); the reviewed router's
//     getAmountsOut at the same block must equal the model output exactly. Token transfer taxes are NOT modelled.
// Both records are POOL-SCOPED (scope = selected pair). The rule gate accepts liquidity in both polarities (a measured
// pool fact) and exit impact positive-only (a low model impact says nothing about taxes or restrictions).
const keccak=require('../../keccak');
const v2=require('../../liquidity-exit-v2');
const {runOperators,buildRecord,fail}=require('./operators');
module.exports={};
