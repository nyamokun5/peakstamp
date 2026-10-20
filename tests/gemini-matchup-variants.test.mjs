import test from 'node:test';
import assert from 'node:assert/strict';
import {calloutPrompt} from '../api/gemini-audio.js';

test('transcription prompt explicitly covers number team pair colloquialisms',()=>{
 const prompt=calloutPrompt(70);
 for(const spoken of [
  '1対2','1と2','一と二','いちとに','1・2','1、2',
  '1番と2番','1番対2番','1チームと2チーム','チーム1対チーム2',
  '1と2の試合','1と2です','1番2番お願いします','ワンとツー',
  'one and two','one versus two','team one against team two'
 ])assert.ok(prompt.includes(spoken),'missing example: '+spoken);
});
test('recognizes variable pairings, colors, names without assuming match score',()=>{
 const prompt=calloutPrompt(70);
 for(const spoken of ['1と3','2と4','3対5','4番と6番',
  '赤対青','赤と青','青対黄色','レッド対ブルー','チームAとB','A対B'])
  assert.ok(prompt.includes(spoken),'missing '+spoken);
 assert.match(prompt,/ANY team numbers/);
 assert.match(prompt,/NOT automatically a score/);
 assert.match(prompt,/mid-game score report/);
 assert.match(prompt,/counting/);
 assert.match(prompt,/jersey numbers/);
 assert.match(prompt,/verbatim/);
});
test('goal and assist variants retained; generic cheers are not asserted goals',()=>{
 const prompt=calloutPrompt(70);
 for(const spoken of ['山田さんゴール','佐藤さんのゴール','山田が決めた',
  '佐藤さんアシスト','アシスト佐藤さん','ナイシュー','惜しい'])
  assert.ok(prompt.includes(spoken),'missing '+spoken);
 assert.match(prompt,/Do not confuse future predictions/);
 assert.match(prompt,/Do not interpret just a pass/);
 assert.match(prompt,/An empty list is correct/);
});
