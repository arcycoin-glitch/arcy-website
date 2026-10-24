'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fallback=require('../lib/pulse-display-fallback');
const pulse=require('../api/pulse');
test('Pulse fallback is explicitly not current-week news',()=>{
 const result=fallback.fallback(Date.parse('2026-10-19T12:00:00Z'));
 assert.equal(result.status,'source_pending');
 assert.equal(result.cards.length,3);
 assert.ok(result.cards.every(x=>x.verifiedCurrentWeek===false&&x.publishedAt===null&&x.contentType==='SOURCE_GUIDE'));
 assert.match(result.take,/not a weekly research conclusion/i);
});
test('Pulse response marks source guides as not verified weekly research',()=>{
 const current={number:4,status:'source_pending',generatedAt:null,
  cycle:{start:'2026-10-19T00:00:00Z',end:'2026-10-26T00:00:00Z'},
  cards:[],take:'',sources:[],audit:{}};
 const value=pulse.threeSections(current.cards,{status:current.status,cycle:current.cycle});
 assert.ok(value.every(x=>x.verifiedCurrentWeek===false&&x.contentType==='SOURCE_GUIDE'));
});
