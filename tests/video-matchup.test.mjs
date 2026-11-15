import test from 'node:test';
import assert from 'node:assert/strict';
import {matchupFromUtterance} from '../video-matchup.mjs';
test('parses first-match audio label even when Gemini omitted team fields',()=>{
 assert.deepEqual(matchupFromUtterance({kind:'match_start',quote:'1試合目 1対2',match_label:'1対2'}),{teamA:'1',teamB:'2'});
 assert.deepEqual(matchupFromUtterance({kind:'match_start',quote:'決勝1対3',match_label:'決勝1対3'}),{teamA:'1',teamB:'3'});
 assert.equal(matchupFromUtterance({kind:'match_start',quote:'始まった始まった',match_label:null}),null);
});

test('fourth video final announcement wins over unrelated English pitch announcements',async()=>{
 const {videoMatchup}=await import('../video-matchup.mjs');
 const source={file:{name:'IMG_3463.MOV',size:742146255,lastModified:123456}};
 const key='IMG_3463.MOV::742146255::123456';
 const cache={[key]:{utterances:[
  {kind:'match_start',time_seconds:0.5,quote:'はい 1対3 決勝',match_label:'1対3 決勝'},
  {kind:'match_start',time_seconds:96.5,quote:'Sailors Blue Girls 8, JSSL FC 2 Girls 8 in pitch number 4',match_label:'Sailors Blue Girls 8 vs JSSL FC 2 Girls 8'},
  {kind:'match_start',time_seconds:106.5,quote:'Sailors White Girls 8 versus JSSL FC 1 Girls 8 at pitch 3',match_label:'Sailors White Girls 8 vs JSSL FC 1 Girls 8'}
 ]}};
 const storage={getItem:k=>k==='peakstamp_gemini_primary_json_v1'?JSON.stringify(cache):null};
 assert.deepEqual(videoMatchup(source,storage),{teamA:'1',teamB:'3',origin:'audio'});
});

test('opening final announcement beats later explicit other-pitch match fields',async()=>{
 const {videoMatchup}=await import('../video-matchup.mjs');
 const source={file:{name:'IMG_3463.MOV',size:742146255,lastModified:123456}};
 const key='IMG_3463.MOV::742146255::123456';
 const cache={[key]:{utterances:[
  {kind:'match_start',time_seconds:0.5,quote:'はい 1対3 決勝',match_label:'1対3 決勝'},
  {kind:'match_start',time_seconds:96.5,team_a:'Sailors Blue Girls 8',team_b:'JSSL FC 2 Girls 8'},
  {kind:'match_start',time_seconds:106.5,team_a:'Sailors White Girls 8',team_b:'JSSL FC 1 Girls 8'}
 ]}};
 const storage={getItem:k=>k==='peakstamp_gemini_primary_json_v1'?JSON.stringify(cache):null};
 assert.deepEqual(videoMatchup(source,storage),{teamA:'1',teamB:'3',origin:'audio'});
});
