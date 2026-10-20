import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCallouts,mergeCalloutSegments,formatCalloutTime} from '../gemini-callouts.mjs';

test('extracts literal matchup phrase without converting it to a score',()=>{
 const rows=normalizeCallouts([{time_seconds:4,kind:'match_start',
  quote:'1対2 チームの試合を始めます',match_label:'1対2',
  team_a:'チーム1',team_b:'チーム2',confidence:'high'}],70);
 assert.equal(rows.length,1);
 assert.equal(rows[0].match_label,'1対2');
 assert.equal(rows[0].team_a,'チーム1');
 assert.equal(rows[0].kind,'match_start');
 assert.equal(rows[0].scorer,null);
});
test('keeps explicitly spoken scorer and assist separate from generic reactions',()=>{
 const rows=normalizeCallouts([
  {time_seconds:25,kind:'goal_call',quote:'山田さんゴール、佐藤さんアシスト',
   scorer:'山田さん',assist:'佐藤さん',confidence:'high'},
  {time_seconds:30,kind:'excited_reaction',quote:'惜しい'},
  {time_seconds:40,kind:'goal_call',quote:''},
  {time_seconds:-1,kind:'goal_call',quote:'ゴール'}
 ],70);
 assert.equal(rows.length,1);
 assert.equal(rows[0].scorer,'山田さん');
 assert.equal(rows[0].assist,'佐藤さん');
});
test('overlapping 70-second segments get absolute times and deduplicate identical callouts',()=>{
 const combined=mergeCalloutSegments([
  {startSeconds:0,durationSeconds:70,utterances:[
   {time_seconds:3,kind:'match_start',quote:'1対2',match_label:'1対2'},
   {time_seconds:66,kind:'goal_call',quote:'山田さんゴール',scorer:'山田さん',confidence:'low'}]},
  {startSeconds:65,durationSeconds:70,utterances:[
   {time_seconds:1.5,kind:'goal_call',quote:'山田さんゴール',scorer:'山田さん',confidence:'high'},
   {time_seconds:33,kind:'goal_call',quote:'西村さんゴール',scorer:'西村さん',confidence:'high'}]}
 ],135);
 assert.equal(combined.length,3);
 assert.equal(combined[1].time_seconds,66);
 assert.equal(combined[1].confidence,'high');
 assert.equal(combined[2].time_seconds,98);
});
test('nearby but distinct goal announcements remain separate',()=>{
 const rows=mergeCalloutSegments([{startSeconds:0,durationSeconds:70,utterances:[
  {time_seconds:40,kind:'goal_call',quote:'山田さんゴール'},
  {time_seconds:42,kind:'goal_call',quote:'佐藤さんゴール'}
 ]}],70);
 assert.equal(rows.length,2);
});
test('invalid records cannot add fabricated fields or crash the pilot',()=>{
 assert.deepEqual(normalizeCallouts(null,70),[]);
 assert.deepEqual(normalizeCallouts([{time_seconds:1000,kind:'goal_call',quote:'Goal'}],70),[]);
 assert.equal(formatCalloutTime(101),'01:41');
 assert.equal(formatCalloutTime(-10),'00:00');
});
