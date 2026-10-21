import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const standalone=readFileSync(new URL("../safari-video-isolation.html", import.meta.url),"utf8");
const app=readFileSync(new URL("../index.html", import.meta.url),"utf8");

test("standalone Safari page has valid JavaScript and native video playback",()=>{
 const inline=standalone.match(/<script>([\s\S]*?)<\/script>/i);
 assert.ok(inline,"inline test script missing");
 assert.doesNotThrow(()=>new vm.Script(inline[1]));
 assert.match(standalone,/<video id="player" controls playsinline/);
 assert.match(standalone,/requestVideoFrameCallback/);
 assert.match(standalone,/lastRenderedMediaTime/);
});

test("standalone video uses only a user-chosen local file and no app persistence or uploads",()=>{
 assert.match(standalone,/type="file"/);
 assert.match(standalone,/URL\.createObjectURL\(selected\)/);
 assert.doesNotMatch(standalone,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
 assert.match(standalone,/URL\.revokeObjectURL\(url\)/);
});

test("goal debugging links isolated comparison without modifying existing control IDs",()=>{
 assert.match(app,/safari-video-isolation\.html\?v=46/);
 for(const id of ["goalStatsPlayEarlier","goalStatsNativeFullscreen","goalStatsCopyDebug","goalStatsDebugOutput"])
  assert.match(app,new RegExp('id="'+id+'"'));
 for(const id of ["at","earlier","zero","fresh","full","copy"])
  assert.match(standalone,new RegExp('id="'+id+'"'));
});
