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
 ],source);
 assert.equal(output.length,1);
 assert.match(output[0].title,/implement fixed-rate borrow accounting/);
 assert.match(output[0].whyItMatters,/does not prove/);
});
