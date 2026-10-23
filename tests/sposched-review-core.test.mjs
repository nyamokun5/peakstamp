import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePerson,normalizeTeam,normalizeSpoSnapshot,prepareGoalRows,
 selectPlayerCandidates,findPotentialDuplicate,existingGoalsForMatch,matchingExistingGoals,
 inferMatchFromCommentary,spokenNameTokens,scoredPlayerCandidates,suggestedPlayer,
 validateGoalRow,buildReviewPayload}
 from '../sposched-review-core.mjs';
const event=()=>({
 event:'日曜定期',event_id:'eeaed234-e9f0-4999-b05e-ec01c7b656fc',
 matches:[
 {seq:1,title:'#1 Team1 vs Team2',left_team:'Team1',right_team:'Team2',
  left_score:1,right_score:0,
  goals:[{goal_id:'old1',scorer:'Tyler Takasaki',assist:null,team:'Team1'}]},
 {seq:null,title:'Drone',left_team:'Team1',right_team:'Team2'},
 {seq:2,title:'#2 Team3 vs Team4',left_team:'Team3',right_team:'Team4',
  left_score:0,right_score:1,
  goals:[{goal_id:'old2',scorer:'Hiroyuki Kawata',assist:'Yuki Noda',team:'Team4'}]}
 ],roster:{
  'チーム1':['Tyler Takasaki','Yutaka Nakajima'],
  'チーム2':['芦田','西村'],
  'チーム3':['Gasuke.Y','Taisei Kobayashi'],
  'チーム4':['Hiroyuki Kawata','Yuki Noda']
 }
});
const exported=()=>({kind:'peakstamp-confirmed-goals',goals:[
 {id:'goal-a',source:{name:'IMG_A.mov'},goalTimeSeconds:25,quote:'タイラーさんゴール！',
  scorer:'Tyler Takasaki',assist:null,assistStatus:'none',matchSeq:1,
  teamA:'Team1',teamB:'Team2'},
 {id:'goal-b',source:{name:'IMG_B.mov'},goalTimeSeconds:76,quote:'川田さんゴール、野田さんアシスト',
  scorer:'川田さん',assist:'野田さん',assistStatus:'named',matchSeq:null,
  teamA:'Team3',teamB:'Team4'}
]});
test('normalizes real SpoSched get_match_results and ignores Drone / highlight placeholders',()=>{
 const result=normalizeSpoSnapshot(event());
 assert.equal(result.eventId,'eeaed234-e9f0-4999-b05e-ec01c7b656fc');
 assert.deepEqual(result.matches.map(x=>x.seq),[1,2]);
 assert.equal(result.players.length,8);
 assert.equal(result.playerTeam.get('Yuki Noda'),'チーム4');
 assert.equal(result.matches[0].existingGoals[0].scorer,'Tyler Takasaki');
});
test('handles roster チームN / match TeamN spelling',()=>{
 assert.equal(normalizeTeam('チーム４'),normalizeTeam('Team4'));
 const snap=normalizeSpoSnapshot(event());
 assert.deepEqual(selectPlayerCandidates('Tyler Takasaki',snap,'Team1')[0].name,'Tyler Takasaki');
 assert.equal(normalizePerson(' 野田さん '),normalizePerson('野田'));
});
test('fails closed when snapshot does not have official event id, duplicated seq or matches',()=>{
 assert.throws(()=>normalizeSpoSnapshot({roster:{}}),/matches/);
 assert.throws(()=>normalizeSpoSnapshot({matches:[],roster:{}}),/イベントID/);
 const data=event();data.matches[1].seq=1;
 assert.throws(()=>normalizeSpoSnapshot(data),/seqが重複/);
});
test('matching may suggest candidates but NEVER marks goals human confirmed',()=>{
 const snap=normalizeSpoSnapshot(event());
 const rows=prepareGoalRows(exported(),snap);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(x=>x.seq),[1,2]);
 assert.equal(rows[0].scorer,'Tyler Takasaki','unique high-confidence AI name now preselected');
 assert.equal(rows[0].confirmed,false,'preselection must not mark the goal human-confirmed');
 assert.equal(rows[1].scorer,'Hiroyuki Kawata','Japanese surname can suggest Romanized member');
 assert.equal(rows[1].confirmed,false,'the suggestion still needs human verification');
 assert.equal(validateGoalRow(rows[0],snap),'選手・試合の確認が必要です');
});
test('buildReviewPayload maps manually selected scorer/assist to official record_goal parameters',()=>{
 const snap=normalizeSpoSnapshot(event());
 const rows=prepareGoalRows(exported(),snap);
 // The real historical snapshot already contains both goals; adjust old
 // goals here to avoid duplicate and test the NEW unrecorded submissions.
 snap.matches[0].existingGoals=[];
 snap.matches[1].existingGoals=[];
 rows[0].scorer='Tyler Takasaki';rows[0].team='Team1';rows[0].confirmed=true;
 rows[1].scorer='Hiroyuki Kawata';rows[1].assist='Yuki Noda';rows[1].team='Team4';
 rows[1].confirmed=true;
 const payload=buildReviewPayload(snap,rows);
 assert.equal(payload.status,'human-reviewed-NOT-SENT');
 assert.equal(payload.operations.length,2);
 assert.deepEqual(payload.operations.map(x=>x.action),['record_goal','record_goal']);
 assert.deepEqual(payload.operations[1].args,{
  event_id:snap.eventId,seq:2,scorer:'Hiroyuki Kawata',team:'Team4',assist:'Yuki Noda'
 });
 assert.equal(payload.operations[0].args.assist,undefined);
});
test('refuses duplicate scorer/assist/team in same match until human resolves it',()=>{
 const snap=normalizeSpoSnapshot(event());
 const row=prepareGoalRows(exported(),snap)[0];
 row.scorer='Tyler Takasaki';row.team='チーム1';row.confirmed=true;
 assert.equal(findPotentialDuplicate(row,snap),true);
 assert.throws(()=>buildReviewPayload(snap,[row]),/登録済みゴール/);
 row.duplicateApproved=true;
 const data=buildReviewPayload(snap,[row]);
 assert.equal(data.operations.length,1);
 assert.equal(data.operations[0].args.scorer,'Tyler Takasaki',
  'the human may confirm a second legitimate goal from the same scorer');
});
test('blocks missing match assignment, uncertain assist and invalid team',()=>{
 const snap=normalizeSpoSnapshot(event());snap.matches.forEach(m=>m.existingGoals=[]);
 const row=prepareGoalRows(exported(),snap)[1];row.confirmed=true;
 row.scorer='Hiroyuki Kawata';row.team='Team4';row.seq=null;
 assert.match(validateGoalRow(row,snap),/試合番号/);
 row.seq=2;row.assistMode='unknown';
 assert.match(validateGoalRow(row,snap),/アシスト/);
 row.assistMode='named';row.assist='Yuki Noda';
 assert.equal(validateGoalRow(row,snap),null);
 row.team='Team2';
 assert.match(validateGoalRow(row,snap),/得点チーム/);
});
test('match score is ONLY included after explicit include and human confirmation',()=>{
 const snap=normalizeSpoSnapshot(event());snap.matches.forEach(m=>m.existingGoals=[]);
 const row=prepareGoalRows(exported(),snap)[0];row.scorer='Tyler Takasaki';
 row.team='Team1';row.confirmed=true;
 let payload=buildReviewPayload(snap,[row],[
  {seq:1,include:false,confirmed:false,leftScore:3,rightScore:2}
 ]);
 assert.equal(payload.operations.length,1);
 assert.throws(()=>buildReviewPayload(snap,[row],[{
  seq:1,include:true,confirmed:false,leftScore:3,rightScore:2
 }]),/確認してください/);
 payload=buildReviewPayload(snap,[row],[{
  seq:1,include:true,confirmed:true,leftScore:3,rightScore:2
 }]);
 assert.equal(payload.operations[0].action,'record_match');
 assert.equal(payload.operations[0].args.left_score,3);
 assert.equal(payload.operations[1].action,'record_goal');
});
test('portal never has direct write fetch, API secrets or automatic side effects',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(home,/sposched-review\.html/);
 assert.match(html,/record_goal/);
 assert.match(html,/人が選択/);
 assert.doesNotMatch(html,/fetch\s*\(/);
 assert.doesNotMatch(html,/localStorage\.clear/);
 assert.doesNotMatch(html,/apiKey|api_key|Bearer\s+\w/i);
 assert.match(html,/未送信/);
});

test('spoken team matchup 2対3 identifies actual #3, not match #2 or score 2-3',()=>{
 const snap=normalizeSpoSnapshot({...event(),matches:[
  ...event().matches,
  {seq:3,title:'#3 Team2 vs Team3',left_team:'Team2',right_team:'Team3',goals:[
   {goal_id:'already',scorer:'Tyler Takasaki',assist:'Taisei Kobayashi',team:'Team3'}
  ]},
  {seq:4,left_team:'Team1',right_team:'Team4',goals:[]}
 ],roster:{...event().roster,
  'チーム1':['Yutaka Nakajima'],
  'チーム3':['Gasuke.Y','Taisei Kobayashi','Tyler Takasaki']
 }});
 const goal={id:'from-voice',matchLabel:'２対３',teamA:'2',teamB:'3',
  scorer:'高崎さん',assist:'たいせい',assistStatus:'named',
  source:{name:'IMG_5293.MOV'},goalTimeSeconds:107.5};
 const matched=inferMatchFromCommentary(goal,snap);
 assert.equal(matched.seq,3);
 assert.equal(matched.confidence,'high');
 assert.match(matched.source,/実況/);
 const row=prepareGoalRows({goals:[goal]},snap)[0];
 assert.equal(row.seq,3);
 assert.equal(row.scorer,'Tyler Takasaki','kanji surname selects unique Romanized roster name');
 assert.equal(row.assist,'Taisei Kobayashi','hiragana first name selects Romanized roster name');
 assert.equal(row.team,'Team3');
 assert.equal(row.confirmed,false,'automatic guesses never count as human verification');
 assert.equal(row.duplicateApproved,false);
 assert.equal(matchingExistingGoals(row,snap).length,1,
  'existing goal is surfaced before another same-scorer/assist goal is drafted');
 assert.equal(existingGoalsForMatch(row,snap)[0].id,'already');
});
test('speech match pairing recognizes 「2番と3番」 and Team2 vs Team3',()=>{
 const snap=normalizeSpoSnapshot({...event(),matches:[
  {seq:3,left_team:'Team2',right_team:'Team3',goals:[]},
  {seq:4,left_team:'Team1',right_team:'Team4',goals:[]}
 ]});
 for(const v of ['2番と3番','２対３','Team2 vs Team3','チーム2対チーム3','2-3']){
  const inf=inferMatchFromCommentary({matchLabel:v},snap);
  assert.equal(inf.seq,3,'did not map '+v);
 }
});
test('repeated same pair is ambiguous; explicit confirmed seq is retained but conflict indicated',()=>{
 const snap=normalizeSpoSnapshot({...event(),matches:[
  {seq:1,left_team:'Team2',right_team:'Team3'},
  {seq:3,left_team:'Team3',right_team:'Team2'},
  {seq:4,left_team:'Team1',right_team:'Team4'}
 ]});
 const g={matchLabel:'2対3',teamA:'2',teamB:'3'};
 const inferred=inferMatchFromCommentary(g,snap);
 assert.equal(inferred.seq,null);
 assert.equal(inferred.ambiguous,true);
 assert.deepEqual(inferred.candidates,[1,3]);
 const explicit=inferMatchFromCommentary({...g,matchSeq:3},snap);
 assert.equal(explicit.seq,3);
 assert.equal(explicit.conflict,false);
 const contradiction=inferMatchFromCommentary({...g,matchSeq:4},snap);
 assert.equal(contradiction.seq,4);
 assert.equal(contradiction.conflict,true);
});
test('Japanese kana and kanji AI phrases suggest probable roster members but never ambiguous surnames',()=>{
 const snap=normalizeSpoSnapshot(event());
 assert.equal(spokenNameTokens('高崎さん').includes('takasaki'),true);
 assert.equal(spokenNameTokens('たいせい').includes('taisei'),true);
 assert.equal(suggestedPlayer('高崎さん',snap).name,'Tyler Takasaki');
 assert.equal(suggestedPlayer('たいせい',snap).name,'Taisei Kobayashi');
 assert.equal(suggestedPlayer('野田さん',snap).name,'Yuki Noda');
 assert.equal(suggestedPlayer('完全に別名',snap).name,'');
 const copy={...snap,players:[...snap.players,'Ken Takasaki']};
 assert.equal(suggestedPlayer('高崎さん',copy).name,'',
  'when two players share a surname do not guess which one');
 const short=scoredPlayerCandidates('高',snap);
 assert.equal(short.length,0,'a single kanji cannot cause unsafe roster auto-match');
});
test('an inferred match and a likely player are never enough to export without confirmation',()=>{
 const snap=normalizeSpoSnapshot({...event(),matches:[
  {seq:3,left_team:'Team2',right_team:'Team3',goals:[]}
 ],roster:{...event().roster,
  'チーム1':['Yutaka Nakajima'],
  'チーム3':['Gasuke.Y','Taisei Kobayashi','Tyler Takasaki']
 }});
 const g={id:'x',source:{name:'clip.mov'},matchLabel:'2対3',teamA:'2',teamB:'3',
  scorer:'高崎さん',assist:'たいせい',assistStatus:'named'};
 const row=prepareGoalRows({goals:[g]},snap)[0];
 assert.equal(row.seq,3);
 assert.equal(row.confirmed,false);
 assert.throws(()=>buildReviewPayload(snap,[row]),/確認が必要/);
 row.confirmed=true;
 const plan=buildReviewPayload(snap,[row]);
 assert.deepEqual(plan.operations[0].args,{
  event_id:snap.eventId,seq:3,scorer:'Tyler Takasaki',assist:'Taisei Kobayashi',team:'Team3'
 });
});


test('2026-10-24 DILF real match skeleton: one official seq, no opponent yet, 22 SS players',()=>{
 const ssPlayers=[
  'Satoshi Nakamura','SUZUKI','松本な','梶原','西村','大川隼',
  'Ashesh','Hidetoshi Akiyama','徳永','Ashikawa','山﨑',
  'Kengo Akimoto','脇阪','Hiroyuki Kawata','石坂 孝博','星',
  '豊田','Akihiro Sato','Soma','Tyler Takasaki','おばたけ','芦田'
 ];
 const raw={event:'試合（11人制）vs DILF',
  event_id:'cf375e6f-8f6d-4eef-9aa1-fdeccf7ac470',
  matches:[
   {seq:1,title:'#1 Match',left_team:'Team1',right_team:null,
    left_score:null,right_score:null,goals:[]},
   {seq:null,title:'#1 Match Drone',left_team:'Team1',right_team:null},
   {seq:null,title:'ゴール集',left_team:null,right_team:null}
  ],roster:{'チーム1':ssPlayers}};
 const snap=normalizeSpoSnapshot(raw);
 assert.equal(snap.matches.length,1);
 assert.equal(snap.matches[0].seq,1);
 assert.equal(snap.matches[0].rightTeam,'DILF',
  'only one external event: opponent from official event title for reviewer');
 assert.equal(snap.matches[0].inferredRightTeam,true);
 assert.equal(snap.players.length,22);
 const g={id:'test',scorer:'高崎さん',assistStatus:'none',source:{name:'DILF.MOV'}};
 const row=prepareGoalRows({goals:[g]},snap)[0];
 assert.equal(row.seq,1,'when a single official match exists, preselect it');
 assert.equal(row.matchGuess.source,'このイベントには試合が1件のみ');
 assert.equal(row.scorer,'Tyler Takasaki');
 assert.equal(row.team,'Team1');
 assert.equal(row.confirmed,false,'one match and roster-based guesses never auto-confirm');
 row.confirmed=true;
 assert.equal(validateGoalRow(row,snap),null);
 const json=buildReviewPayload(snap,[row]);
 assert.deepEqual(json.operations[0].args,{
  event_id:raw.event_id,seq:1,scorer:'Tyler Takasaki',team:'Team1'});
});
test('external opponents can be entered as explicitly confirmed guest players',()=>{
 const snap=normalizeSpoSnapshot({event:'試合（11人制）vs DILF',event_id:'test-id',
  matches:[{seq:1,left_team:'Team1',right_team:null,goals:[]}],
  roster:{'チーム1':['西村'],'DILF':[]}});
 const goal={id:'g',scorer:'DILF #7',assist:'DILF #9',assistStatus:'named',
  source:{name:'dilf.mov'}};
 const row=prepareGoalRows({goals:[goal]},snap)[0];
 row.guest=true;row.scorer='Confirmed DILF #7';row.assist='Confirmed DILF #9';
 row.team='DILF';row.confirmed=true;
 assert.equal(validateGoalRow(row,snap),null);
 const payload=buildReviewPayload(snap,[row]);
 assert.deepEqual(payload.operations[0].args,{
  event_id:'test-id',seq:1,scorer:'Confirmed DILF #7',
  assist:'Confirmed DILF #9',team:'DILF',guest:true
 });
 row.scorer='';assert.match(validateGoalRow(row,snap),/得点者名/);
 row.scorer='西村';assert.match(validateGoalRow(row,snap),/ゲスト指定を外して/);
});
test('score-only external fixture can export without ANY PS-confirmed goals',()=>{
 const snap=normalizeSpoSnapshot({event:'11人制試合 vs DILF',event_id:'event-id',
  matches:[{seq:1,left_team:'Team1',right_team:null,goals:[]}],
  roster:{'チーム1':['芦田']}});
 assert.equal(snap.matches[0].rightTeam,'DILF');
 const score={seq:1,include:true,confirmed:true,leftScore:2,rightScore:1};
 const out=buildReviewPayload(snap,[],[score]);
 assert.equal(out.operations.length,1);
 assert.deepEqual(out.operations[0],{
  action:'record_match',args:{
   event_id:'event-id',seq:1,left_team:'Team1',right_team:'DILF',
   left_score:2,right_score:1,winner:'left'
  }
 });
 assert.throws(()=>buildReviewPayload(snap,[],[{...score,confirmed:false}]),/確認してください/);
});
test('do not invent external opponent for multiple fixtures or unrelated titles',()=>{
 const raw={event:'11人制 vs DILF',event_id:'id',roster:{},
  matches:[{seq:1,left_team:'Team1',right_team:null},
   {seq:2,left_team:'Team1',right_team:null}]};
 const snap=normalizeSpoSnapshot(raw);
 assert.equal(snap.matches[0].rightTeam,'');
 assert.equal(snap.matches[1].rightTeam,'');
 assert.equal(snap.matches[0].inferredRightTeam,false);
 assert.equal(inferMatchFromCommentary({},snap).seq,null);
});
test('one-match external fixture accepts an already confirmed official match number',()=>{
 const snap=normalizeSpoSnapshot({event:'SS vs DILF',event_id:'id',
  matches:[{seq:1,left_team:'Team1',right_team:'DILF'}],roster:{'チーム1':['西村']}});
 const row=prepareGoalRows({goals:[{matchSeq:1,scorer:'西村',assistStatus:'none'}]},snap)[0];
 assert.equal(row.seq,1);
 assert.equal(row.scorer,'西村');
});
