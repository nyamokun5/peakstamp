import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizePerson,normalizeTeam,normalizeSpoSnapshot,prepareGoalRows,preserveReviewRows,
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
test('production remains read-only; test writes require distinct Worker and manual confirmation',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(home,/sposched-review\.html/);
 assert.match(html,/人が選択/);
 assert.match(html,/fetchSS\('/);
 assert.match(html,/method:'GET'/);
 assert.match(html,/method:'POST'/);
 assert.match(html,/SS_GATEWAYS/);
 assert.match(html,/production:'https:\/\/shoot-sunday-sync\.yomax1979\.workers\.dev'/);
 assert.match(html,/staging:'https:\/\/shoot-sunday-sync-staging\.yomax1979\.workers\.dev'/);
 assert.match(html,/if\(\$\('ssEnvironment'\)\.value!=='staging'\|\|!loadedFromStagingDirect\)/);
 assert.match(html,/confirm:'TEST-ONLY WRITE'/);
 assert.match(html,/resetTestPreview/);
 assert.match(html,/テストSSへこの1件だけ書き込む/);
 assert.doesNotMatch(html,/localStorage\.setItem\([^)]*ssBridgeToken/);
 assert.doesNotMatch(html,/localStorage\.clear/);
 assert.doesNotMatch(html,/apiKey|api_key|Bearer\s+\w/i);
 assert.match(html,/未送信/);
 const {Script}=requireVm();
 // Syntax-check the inline module after eliding ESM imports; browser resolves them separately.
 const inline=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||'';
 assert.ok(inline.length>2000);
 assert.doesNotThrow(()=>new Script(inline.replace(/^import\s+[^;]+;$/gm,'')));
});
function requireVm(){return {Script:vm.Script}}

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

test('confirmed manual correction creates a PATCH proposal using stable match and goal IDs',()=>{
 const matchId='5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
 const goalId='6b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
 const source={event_id:'7b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e',event:{name:'Test'},
  roster:{'チーム1':['山田','田中','佐藤'],'チーム2':['高橋']},
  matches:[{seq:1,match_id:matchId,left_team:'チーム1',right_team:'チーム2',
   left_score:1,right_score:0,goals:[{goal_id:goalId,scorer:'山田',
    assist:'田中',team:'チーム1',own_goal:false,scored_at:'2026-10-25T07:08:00+08:00'}]}]};
 const snap=normalizeSpoSnapshot(source);
 assert.equal(snap.matches[0].matchId,matchId);
 const goal={id:'ps-1',source:{name:'IMG_1.MOV'},scorer:'山田',
  assist:'佐藤',assistStatus:'named',matchSeq:1,goalTimeSeconds:40};
 const [row]=prepareGoalRows({goals:[goal]},snap);
 row.include=true;row.seq=1;row.scorer='山田';row.assist='佐藤';
 row.assistMode='named';row.team='チーム1';row.confirmed=true;row.updateGoalId=goalId;
 const data=buildReviewPayload(snap,[row]);
 assert.equal(data.operations.length,1);
 const operation=data.operations[0];
 assert.equal(operation.action,'patch_goal');
 assert.equal(operation.args.match_id,matchId);
 assert.equal(operation.args.goal_id,goalId);
 assert.deepEqual(operation.args.patch,{assist:{name:'佐藤'}});
 assert.equal(operation.expected.assist,'田中');
 assert.equal(data.status,'human-reviewed-NOT-SENT');
 row.assist='田中';
 assert.throws(()=>buildReviewPayload(snap,[row]),/更新は不要/);
 row.assist='佐藤';row.team='チーム2';
 assert.throws(()=>buildReviewPayload(snap,[row]),/得点チームが異なります/);
});
test('goal updates reject unknown and non-UUID registered targets',()=>{
 const snap=normalizeSpoSnapshot({
  event_id:'7b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e',event:'Test',
  roster:{Team1:['A','B']},
  matches:[{seq:1,match_id:'5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e',
   left_team:'Team1',right_team:'Team2',
   goals:[{goal_id:'invalid-id',scorer:'A',assist:null,team:'Team1'}]}]});
 const [row]=prepareGoalRows({goals:[{id:'from-ps',scorer:'B',assist:null,
  assistStatus:'none',matchSeq:1,source:{name:'demo.MOV'}}]},snap);
 Object.assign(row,{include:true,confirmed:true,seq:1,team:'Team1',scorer:'B',assistMode:'none',updateGoalId:'invalid-id'});
 assert.throws(()=>buildReviewPayload(snap,[row]),/goal_id/);
 row.updateGoalId='6b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
 assert.throws(()=>buildReviewPayload(snap,[row]),/goal_id/);
});

test('first SS goal write preserves second goal scorer and assist edits in the same event',()=>{
 const snap=normalizeSpoSnapshot(event());
 const old=prepareGoalRows(exported(),snap);
 assert.equal(old.length,2);
 Object.assign(old[0],{seq:1,scorer:'Tyler Takasaki',team:'Team1',
  assistMode:'none',confirmed:true,include:true});
 Object.assign(old[1],{seq:2,scorer:'Hiroyuki Kawata',assist:'Yuki Noda',
  team:'Team4',assistMode:'named',confirmed:true,include:true,duplicateApproved:true});
 const latest=normalizeSpoSnapshot({...event(),matches:event().matches.map(m=>
  m.seq===1?{...m,left_score:2,goals:[...m.goals,
  {goal_id:'new',scorer:'Tyler Takasaki',assist:null,team:'Team1'}]}:m)});
 const next=preserveReviewRows(prepareGoalRows(exported(),latest),old,{
  sameEvent:true,completedKeys:[old[0].key],snapshot:latest});
 assert.equal(next[0].include,false,'already written first goal is excluded from the next batch');
 assert.equal(next[0].confirmed,false,'confirmation must be repeated after refresh');
 assert.equal(next[1].include,true);
 assert.equal(next[1].seq,2);
 assert.equal(next[1].scorer,'Hiroyuki Kawata');
 assert.equal(next[1].assist,'Yuki Noda');
 assert.equal(next[1].assistMode,'named');
 assert.equal(next[1].team,'Team4');
 assert.equal(next[1].confirmed,false,'fresh official SS state requires renewed confirmation');
 assert.equal(next[1].duplicateApproved,false,'no stale duplicate bypass');
 assert.equal(old[1].confirmed,true,'original row object remains untouched');
});
test('editing goal #2 cannot leak into goal #1 and changing event resets all edits',()=>{
 const snap=normalizeSpoSnapshot(event()),rows=prepareGoalRows(exported(),snap);
 rows[1].scorer='Gasuke.Y';rows[1].assistMode='none';rows[1].confirmed=true;
 const fresh=preserveReviewRows(prepareGoalRows(exported(),snap),rows,{sameEvent:true,snapshot:snap});
 assert.equal(fresh[1].scorer,'Gasuke.Y');
 assert.equal(fresh[1].assistMode,'none');
 assert.equal(fresh[0].scorer,rows[0].scorer);
 const changed=preserveReviewRows(prepareGoalRows(exported(),snap),rows,{sameEvent:false,snapshot:snap});
 assert.notEqual(changed[1].scorer,'Gasuke.Y');
 assert.notEqual(changed[1].assistMode,'none');
});
test('preserved goal correction target must exist in latest official match',()=>{
 const raw=event();
 const goalId='6b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
 raw.matches.find(m=>m.seq===2).goals[0].goal_id=goalId;
 const snap=normalizeSpoSnapshot(raw);
 const prior=prepareGoalRows(exported(),snap);
 prior[1].updateGoalId=goalId;
 const kept=preserveReviewRows(prepareGoalRows(exported(),snap),prior,{sameEvent:true,snapshot:snap});
 assert.equal(kept[1].updateGoalId,goalId);
 const newer=normalizeSpoSnapshot({...raw,matches:raw.matches.map(m=>m.seq===2?{...m,goals:[]}:m)});
 const removed=preserveReviewRows(prepareGoalRows(exported(),newer),prior,{sameEvent:true,snapshot:newer});
 assert.equal(removed[1].updateGoalId,'');
});

test('4-team knockout match numbers bind VIDEO to third-place and final UUID before teams exist',()=>{
 const thirdId='12345678-1234-4234-9234-1234567890ab';
 const finalId='87654321-4321-4321-a321-ba0987654321';
 const snap=normalizeSpoSnapshot({event_id:'eeaed234-e9f0-4999-b05e-ec01c7b656fc',
  event:'Shoot Sunday four-team',matches:[
   {seq:1,title:'予選1',left_team:'チーム1',right_team:'チーム2'},
   {seq:2,title:'予選2',left_team:'チーム3',right_team:'チーム4'},
   {seq:5,title:'3位決定戦',match_id:thirdId,status:'waiting',left_team:null,right_team:null},
   {seq:6,title:'決勝戦',match_id:finalId,status:'waiting',left_team:null,right_team:null}
  ],roster:{'チーム1':['西村','佐藤'],'チーム2':['橋本'],
   'チーム3':['豊田'],'チーム4':['山田']}});
 const goals=[
  {id:'video-third',matchSeq:5,teamA:'1',teamB:'2',
   scorer:'西村',assistStatus:'none',source:{name:'third.mov'}},
  {id:'video-final',matchSeq:6,teamA:'3',teamB:'4',
   scorer:'山田',assistStatus:'none',source:{name:'final.mov'}}
 ];
 const rows=prepareGoalRows({goals},snap);
 assert.deepEqual(rows.map(row=>row.seq),[5,6]);
 assert.deepEqual(rows.map(row=>row.matchGuess.fixtureMatchId),[thirdId,finalId]);
 assert.deepEqual(rows.map(row=>row.matchGuess.conflict),[false,false]);
 assert.equal(snap.matches.find(m=>m.seq===5).status,'waiting');
 assert.equal(snap.matches.find(m=>m.seq===6).title,'決勝戦');
 assert.equal(rows[0].matchGuess.confidence,'high',
  'initial file match number is the primary identity, not guessed opponents');
});
test('after teams are assigned the same goal stays on original numbered final, not any rematch pairing',()=>{
 const eventId='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 const matchId='87654321-4321-4321-a321-ba0987654321';
 const waiting=normalizeSpoSnapshot({event_id:eventId,matches:[
  {seq:1,left_team:'チーム1',right_team:'チーム2'},
  {seq:6,title:'決勝戦',match_id:matchId,status:'waiting',left_team:null,right_team:null}
 ],roster:{'チーム1':['西村'],'チーム2':['橋本']}});
 const goal={id:'g-final',source:{name:'FINAL.MOV'},matchSeq:6,
  scorer:'西村',assistStatus:'none',teamA:'1',teamB:'2'};
 const before=prepareGoalRows({goals:[goal]},waiting)[0];
 const completed=normalizeSpoSnapshot({event_id:eventId,matches:[
  {seq:1,left_team:'チーム1',right_team:'チーム2'},
  {seq:6,title:'決勝戦',match_id:matchId,status:'scheduled',left_team:'チーム1',right_team:'チーム2'}
 ],roster:{'チーム1':['西村'],'チーム2':['橋本']}});
 const after=prepareGoalRows({goals:[goal]},completed)[0];
 assert.equal(before.seq,6);
 assert.equal(after.seq,6);
 assert.equal(after.matchGuess.fixtureMatchId,matchId);
 assert.equal(after.team,'チーム1');
 assert.equal(after.matchGuess.conflict,false,
  'a repeated team pairing must never override an explicit assigned fixture number');
});

test('updated SS fixture number alias preserves knockout identity before and after teams resolve',()=>{
 const eventId='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 const id='87654321-4321-4321-a321-ba0987654321';
 const provisional=normalizeSpoSnapshot({event_id:eventId,matches:[
  {number:6,title:'決勝戦',status:'waiting',match_id:'',
   left_team:null,right_team:null}],
  roster:{'チーム1':['西村'],'チーム2':['橋本']}});
 assert.equal(provisional.matches[0].seq,6);
 assert.equal(provisional.matches[0].matchId,'');
 const goal={matchSeq:6,scorer:'西村',assistStatus:'none'};
 assert.equal(prepareGoalRows({goals:[goal]},provisional)[0].seq,6);
 const settled=normalizeSpoSnapshot({event_id:eventId,matches:[
  {number:6,seq:6,title:'決勝戦',status:'scheduled',match_id:id,
   left_team:'チーム1',right_team:'チーム2'}],
  roster:{'チーム1':['西村'],'チーム2':['橋本']}});
 assert.equal(prepareGoalRows({goals:[goal]},settled)[0].matchGuess.fixtureMatchId,id);
 assert.equal(settled.matches[0].seq,6);
});
test('reject SS number/seq disagreement and duplicated assigned IDs before a goal can target wrong final',()=>{
 const id='87654321-4321-4321-a321-ba0987654321';
 const e='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 assert.throws(()=>normalizeSpoSnapshot({event_id:e,matches:[
  {number:5,seq:6,match_id:id}]}),/numberとseq/);
 assert.throws(()=>normalizeSpoSnapshot({event_id:e,matches:[
  {number:5,match_id:id},{number:6,match_id:id}]}),/同じmatch_id/);
 assert.throws(()=>normalizeSpoSnapshot({event_id:e,matches:[
  {number:5,match_id:id},{seq:5,match_id:'12345678-1234-4234-9234-1234567890ab'}]}),/重複/);
});

test('real SS 4-team layout keeps #3 third-place and #4 final by seq, excluding Drone and highlight',()=>{
 const eventId='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 const matches=[
  {seq:1,title:'#1 Team1 vs Team2',left_team:'Team1',right_team:'Team2'},
  {seq:null,title:'#1 Team1 vs Team2 Drone'},
  {seq:2,title:'#2 Team3 vs Team4',left_team:'Team3',right_team:'Team4'},
  {seq:null,title:'#2 Team3 vs Team4 Drone'},
  {seq:3,title:'#3 ３位決定戦',left_team:'Team2',right_team:'Team3'},
  {seq:null,title:'#3 ３位決定戦 Drone'},
  {seq:4,title:'#4 決勝',left_team:'Team1',right_team:'Team4'},
  {seq:null,title:'#4 決勝 Drone'},
  {seq:null,title:'ゴール集'}
 ];
 const snap=normalizeSpoSnapshot({event_id:eventId,matches,
  roster:{Team1:['西村'],Team2:['橋本'],Team3:['佐藤'],Team4:['山田']}});
 assert.deepEqual(snap.matches.map(x=>x.seq),[1,2,3,4]);
 assert.equal(snap.matches[2].title,'#3 ３位決定戦');
 assert.equal(snap.matches[3].title,'#4 決勝');
 const goals=[{id:'a',matchSeq:3,scorer:'橋本',assistStatus:'none'},
  {id:'b',matchSeq:4,scorer:'西村',assistStatus:'none'}];
 const prepared=prepareGoalRows({goals},snap);
 assert.deepEqual(prepared.map(x=>x.seq),[3,4]);
});
test('5/6-team rounds with the same title number never substitute for the unique seq',()=>{
 const evt='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 const snap=normalizeSpoSnapshot({event_id:evt,matches:[
  {seq:1,title:'#1 Pitch1',left_team:'Team1',right_team:'Team2'},
  {seq:2,title:'#1 Pitch2',left_team:'Team3',right_team:'Team4'},
  {seq:3,title:'#2 Pitch1',left_team:'Team1',right_team:'Team3'}
 ],roster:{Team1:['西村'],Team2:['橋本'],Team3:['佐藤'],Team4:['山田']}});
 assert.deepEqual(snap.matches.map(x=>x.seq),[1,2,3]);
 const a=prepareGoalRows({goals:[
  {matchSeq:1,scorer:'西村',assistStatus:'none'},
  {matchSeq:2,scorer:'佐藤',assistStatus:'none'}
 ]},snap);
 assert.deepEqual(a.map(x=>x.seq),[1,2]);
});

test('Japanese speech resolves uniquely to Latin SpoSched surname and given name',()=>{
 const snap=normalizeSpoSnapshot({event_id:'eeaed234-e9f0-4999-b05e-ec01c7b656fc',
  matches:[{seq:1,title:'準決勝',left_team:'Team1',right_team:'Team2'}],
  roster:{Team1:['Taro Fujii','Tatsuo Sato'],Team2:['Koji Tanaka']}});
 assert.equal(suggestedPlayer('藤井さん',snap).name,'Taro Fujii');
 assert.equal(suggestedPlayer('藤井さん',snap).confidence,'high');
 assert.equal(suggestedPlayer('達夫',snap).name,'Tatsuo Sato');
 assert.equal(suggestedPlayer('佐藤達夫',snap).name,'Tatsuo Sato');
 assert.equal(suggestedPlayer('Tatsuo Sato',snap).name,'Tatsuo Sato');
 assert.equal(suggestedPlayer('Sato Tatsuo',snap).name,'Tatsuo Sato');
 const rows=prepareGoalRows({goals:[{id:'foo',matchSeq:1,scorer:'藤井さん',
  assist:'達夫',assistStatus:'named'}]},snap);
 assert.equal(rows[0].scorer,'Taro Fujii');
 assert.equal(rows[0].assist,'Tatsuo Sato');
 assert.equal(rows[0].scorerGuess.confidence,'high');
 assert.equal(rows[0].assistGuess.confidence,'high');
 assert.equal(rows[0].team,'Team1');
});
test('similar surnames stay unselected when roster match is ambiguous',()=>{
 const snap=normalizeSpoSnapshot({event_id:'eeaed234-e9f0-4999-b05e-ec01c7b656fc',
  matches:[{seq:1,title:'準決勝',left_team:'Team1',right_team:'Team2'}],
  roster:{Team1:['Taro Fujii'],Team2:['Shun Fujii','Tatsuo Sato']}});
 const result=suggestedPlayer('藤井さん',snap);
 assert.equal(result.name,'');
 assert.equal(result.confidence,'none');
 assert.equal(result.candidates.length>=2,true);
 assert.deepEqual(spokenNameTokens('ふじいさん').includes('fujii'),true);
 assert.equal(suggestedPlayer('聞き取れず',snap).name,'');
});

test('Japanese long-vowel and traditional glyphs resolve to the unique SS roster member',()=>{
 const evt='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 const snap=normalizeSpoSnapshot({event_id:evt,
  matches:[{seq:1,left_team:'Team1',right_team:'Team2'}],
  roster:{Team1:['Taro OHNO','KOICHI','德永'],Team2:['Tatsuo Sato']}});
 const examples=[['大野','Taro OHNO'],['コーイチ','KOICHI'],
  ['徳永','德永'],['德永','德永'],['オオノ','Taro OHNO'],
  ['こういち','KOICHI']];
 for(const [spoken,official] of examples){
  const result=suggestedPlayer(spoken,snap);
  assert.equal(result.name,official,spoken+' should resolve to official roster spelling');
  assert.equal(result.confidence,'high',spoken+' must be a strong, unique match');
 }
 assert.equal(normalizePerson('徳永'),normalizePerson('德永'));
 assert.ok(spokenNameTokens('コーイチ').includes('koichi'));
 assert.ok(spokenNameTokens('コーイチ').includes('kouichi'));
 assert.ok(spokenNameTokens('大野').includes('ohno'));
 assert.ok(spokenNameTokens('大野').includes('ono'));
 const chosen=prepareGoalRows({goals:[
  {id:'ohno',matchSeq:1,scorer:'大野',assistStatus:'none'},
  {id:'koichi',matchSeq:1,scorer:'コーイチ',assistStatus:'none'},
  {id:'tokunaga',matchSeq:1,scorer:'徳永',assistStatus:'none'}
 ]},snap);
 assert.deepEqual(chosen.map(row=>row.scorer),['Taro OHNO','KOICHI','德永']);
 assert.ok(chosen.every(row=>row.scorerGuess.confidence==='high'));
});
test('related spellings do not auto-select when two different roster entries match',()=>{
 const evt='eeaed234-e9f0-4999-b05e-ec01c7b656fc';
 const snap=normalizeSpoSnapshot({event_id:evt,
  matches:[{seq:1,left_team:'Team1',right_team:'Team2'}],
  roster:{Team1:['Taro OHNO','Taro Ono','KOICHI'],
   Team2:['Kouichi','徳永','德永']}});
 for(const spoken of ['大野','コーイチ','徳永']){
  const picked=suggestedPlayer(spoken,snap);
  assert.equal(picked.name,'',spoken+' must be held when alias matches are non-unique');
  assert.equal(picked.confidence,'none');
  assert.ok(picked.candidates.length>=2);
 }
 assert.equal(suggestedPlayer('全然別の人',snap).name,'');
 assert.equal(suggestedPlayer('小野',snap).name,'',
  'unlisted kanji readings are never guessed as another surname');
});
