'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('approved Hero playback retains moving frame during buffering and restores still on pause/error/reduced motion',()=>{
 const listeners={},classes=new Set(),reduced={matches:false,addEventListener(type,fn){this.change=fn;}},frame={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
 const video={closest:()=>frame,addEventListener:(type,fn)=>listeners[type]=fn,pause(){listeners.pause();}};
 const context={document:{querySelector:()=>video,addEventListener(){}},window:{matchMedia:()=>reduced,addEventListener(){},IntersectionObserver:function(){}},navigator:{},IntersectionObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../hero-video.js'),'utf8'),context);
 listeners.playing();assert(classes.has('video-playing'));
 listeners.stalled();assert(classes.has('video-playing'),'buffering must not flash the still over a playing video');
 listeners.pause();assert(!classes.has('video-playing'));
 listeners.playing();listeners.ended();assert(!classes.has('video-playing'));
 listeners.playing();reduced.matches=true;reduced.change();assert(!classes.has('video-playing'));
 reduced.matches=false;listeners.playing();listeners.error();assert(!classes.has('video-playing'));
});
