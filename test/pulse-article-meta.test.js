'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {articleFromMeta}=require('../lib/pulse-edition');
test('reads dated Arc article metadata',()=>{
 const html='<meta property="og:title" content="Arc network update"><meta property="article:published_time" content="2026-10-19T09:00:00Z">';
 const result=articleFromMeta(html,'https://www.arc.io/blog/example');
 assert.equal(result.title,'Arc network update');
 assert.equal(result.publishedAt,'2026-10-19T09:00:00.000Z');
});
test('does not invent missing dates',()=>{
 assert.equal(articleFromMeta('<meta property="og:title" content="Update">','https://www.arc.io/blog/x'),null);
});
