'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const arc=require('../lib/pulse-edition');
const claims=require('../lib/pulse-claim');
const networks=require('../lib/pulse-networks');

const date='2026-11-02T00:00:00.000Z';

test('Pulse extracts project-specific meaning only from a first-party article description',()=>{
 const meta='<html><meta property="og:description" content="Tower Exchange aggregates regional stablecoin liquidity on Arc to make less widely traded currencies accessible through connected pools."></html>';
 const excerpt=arc.articleExcerpt(meta);
 assert.match(excerpt,/aggregates regional stablecoin liquidity/);
 const result=claims.describe({title:'How Tower is Building the Liquidity Layer',publishedAt:date,summary:excerpt},{family:'Official Arc community',type:'links'});
 assert.equal(result.sourceExcerpt,true);
 assert.match(result.summary,/Tower Exchange aggregates/);
 assert.match(result.summary,/First-party source; impact is not independently measured/);
 assert.equal(result.claimType,'ANNOUNCEMENT');
});

test('Pulse never invents a project development when no trustworthy description is supplied',()=>{
 assert.equal(arc.articleExcerpt('<html><title>Arc House</title></html>'),null);
 assert.equal(arc.articleExcerpt('<meta name="description" content="Sign in">'),null);
 const result=claims.describe({title:'Project update',publishedAt:date},{type:'links'});
 assert.equal(result.sourceExcerpt,undefined);
 assert.match(result.summary,/Primary-source news/);
});

test('Pulse filters trivial comments and typo commits but retains functional feature commits',()=>{
 const source=networks.LIVE_PROJECT_SOURCES.robinhood.find(x=>x.project==='Morpho');
 const record=(sha,message)=>({sha:sha.repeat(40),html_url:'https://github.com/morpho-org/morpho-blue/commit/'+sha.repeat(40),commit:{message,committer:{date}}});
 const output=networks.commits([
  record('a','[certora] simplify borrowRateSummary comment'),
  record('b','fix: readme typo'),
  record('c','feat: implement fixed-rate borrow accounting'),
  record('d','refactor: rename internal helper'),
  record('e','Update natspec on liquidation'),
 ],source);
 assert.equal(output.length,1);
 assert.match(output[0].title,/implement fixed-rate borrow accounting/);
 assert.match(output[0].whyItMatters,/does not prove/);
});

test('Pulse research framing: what changed, why (only from change type), verified evidence level, not proven',()=>{
 const src=networks.LIVE_PROJECT_SOURCES.robinhood.find(x=>x.project==='Morpho');
 const rec=(m)=>({sha:'d'.repeat(40),html_url:'https://github.com/morpho-org/morpho-blue/commit/'+'d'.repeat(40),commit:{message:m,committer:{date}}});
 const [feat]=networks.commits([rec('feat(irm): implement fixed-rate borrow accounting')],src);
 const card=networks.researchCard(feat);
 assert.equal(card.research.evidence,'MERGED_CODE');
 assert.match(card.summary,/^Morpho merged to its default branch: implement fixed-rate borrow accounting\. Adds functionality/);
 assert.match(card.summary,/Verified: merged code in the official repository\. Not proven: A code commit does not prove/);
 assert.ok(card.summary.length<=320,'readable in ~15 s: '+card.summary.length);
 const [plain]=networks.commits([rec('Update interest rate model parameters')],src);
 assert.equal(networks.researchCard(plain).research.whyItMatters,null,'no invented significance when the change type is not stated');
 const ann=networks.researchCard({title:'Robinhood Chain mainnet',url:'https://robinhood.com/newsroom/x/',owner:'OFFICIAL ROBINHOOD',summary:'Robinhood Chain opened to developers.',whyItMatters:'A first-party chain announcement; deployment, liquidity and adoption are not independently verified.'});
 assert.equal(ann.research.evidence,'PUBLISHED_ANNOUNCEMENT');assert.equal(ann.research.whyItMatters,null);
 assert.equal(networks.evidenceLevel({url:'https://github.com/ethereum/go-ethereum/releases/tag/v1.16.0'}),'CLIENT_RELEASE');
 assert.equal(networks.evidenceLevel({url:'https://investors.robinhood.com/news-releases/news-release-details/x',owner:'ROBINHOOD MARKETS · OFFICIAL INVESTOR RELATIONS'}),'COMPANY_REPORT');
 const arcCard=claims.describe({title:'How Tower is Building the Liquidity Layer',publishedAt:date,summary:'Tower Exchange aggregates regional stablecoin liquidity on Arc to make less widely traded currencies accessible.'},{family:'Official Arc community',type:'links'});
 assert.deepEqual(Object.keys(arcCard.research),['whatChanged','whyItMatters','evidence','notProven']);
 assert.equal(arcCard.research.evidence,'PUBLISHED_ANNOUNCEMENT');assert.match(arcCard.summary,/Not proven: First-party source/);
});

test('Pulse research framing never presents a cut-off source excerpt as a complete sentence',()=>{
 const cut=networks.researchCard({title:'Ripple and Robinhood Partner',url:'https://ripple.com/ripple-press/x/',owner:'RIPPLE · OFFICIAL PARTNER DISCLOSURES',summary:'RLUSD is live today on Robinhood Chain and Bitstamp by Robinhood, and is expected to be available later this year in the Robinhood',whyItMatters:'Partner-issued announcement.'});
 assert.match(cut.summary,/^RLUSD is live today on Robinhood Chain and Bitstamp by Robinhood, and is expected to be available later this year in the Robinhood… Verified: partner-issued announcement\./);
 const trimmed=networks.researchCard({title:'Q3',url:'https://investors.robinhood.com/news-releases/news-release-details/q3',owner:'ROBINHOOD MARKETS · OFFICIAL INVESTOR RELATIONS',summary:'Robinhood Chain became a top-five chain by revenue and volume. It generated over $80 billion in DEX volume and over $50 million of chain',whyItMatters:'Company-reported.'});
 assert.match(trimmed.summary,/^Robinhood Chain became a top-five chain by revenue and volume\. Verified: company press release\./,'cut back to the last complete sentence');
});

test('Arc excerpts decode double-encoded entities and never end on a cut-off fragment with a full stop',()=>{
 const meta='<meta property="og:description" content="Use the Arc Studio CLI from Claude Code, Codex, Cursor or your terminal. Send onchain tasks, inspect Studio&amp;#x27;s sandbox and pull results into your editor without leaving the workflow you already use every day.">';
 const x=arc.articleExcerpt(meta);
 assert.doesNotMatch(x,/&#x27;|&amp;/);
 assert.match(x,/inspect Studio's sandbox/);
 const long='<meta name="description" content="Tower Exchange brings wallet swaps, route aggregation, and AI-assisted trade review together for stablecoin markets on Arc, with its founder walking through liquidity sources, cross-chain transfers, routing design and the operational controls behind it">';
 const y=arc.articleExcerpt(long);assert.ok(y.endsWith('…'),y);assert.doesNotMatch(y,/,…$/);
 const card=claims.describe({title:'Tower',publishedAt:date,summary:y},{type:'links'});
 assert.doesNotMatch(card.summary,/…\./);assert.match(card.summary,/… Not proven: /);
});
