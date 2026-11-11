import {analyzeAutoFixture} from './sposched-auto-tournament.mjs';
import {fixturePlayerOptions,normalizeTeam} from './sposched-review-core.mjs';

// Presentation only. All writes still pass through the existing signed TEST
// actions, durable journals and official readback. No network calls here.
// A shared spoken nickname is never auto-confirmed, even if AI labels
// its preferred candidate high-confidence. Candidate names must belong to
// the currently selectable official fixture roster.
export function requiresSpokenNameChoice(hints,players,fieldReviewed=false,allReviewed=false){
 if(fieldReviewed||allReviewed)return false;
 const allowed=new Set((players||[]).map(p=>Array.isArray(p)?p[0]:p));
 return new Set((hints||[]).map(h=>h?.name).filter(name=>allowed.has(name))).size>1;
}

// When a shared nickname spans both fixture sides, offer BOTH candidates even
// if the AI guessed a scoring team. Selecting the scorer then updates row.team
// to the chosen official team via editQuickGoalField(). Other matches' players
// remain excluded; assists remain restricted to the selected scoring side.
// The SS knows which event players are assigned to teams before it knows
// the winners/losers of two semifinals. For waiting #3/#4 use ONLY the
// verified current event roster, not blank future fixture sides or history.
// This controls presentation, not API write permissions; the Worker still
// checks that the finished semifinals resolve to the official matchup.
export function isWaitingKnockoutReview(snapshot,row){
 const match=snapshot?.matches?.find(m=>m.seq===Number(row?.seq));
 return snapshot?.rosterSource==='official-current-event-teams'&&
  snapshot.matches?.length===4&&
  [3,4].includes(Number(match?.seq))&&match?.status==='waiting';
}
export function waitingKnockoutRoster(snapshot,row){
 if(!isWaitingKnockoutReview(snapshot,row))return [];
 const assigned=new Set(Object.keys(snapshot.roster||{}).map(normalizeTeam));
 return (snapshot.players||[]).filter(name=>
  assigned.has(normalizeTeam(snapshot.playerTeam?.get(name)||'')));
}
export function scorerRosterForReview(snapshot,row){
 if(isWaitingKnockoutReview(snapshot,row))
  return waitingKnockoutRoster(snapshot,row);
 const assigned=fixturePlayerOptions(snapshot,row?.seq,row?.team);
 const fixture=fixturePlayerOptions(snapshot,row?.seq,'');
 const rf=row?.quickReviewedFields||{};
 return requiresSpokenNameChoice(row?.scorerHints,fixture,rf.scorer,row?.quickReviewedAll)
  ?fixture:assigned;
}
export function assistRosterForReview(snapshot,row){
 if(isWaitingKnockoutReview(snapshot,row))
  return waitingKnockoutRoster(snapshot,row);
 return fixturePlayerOptions(snapshot,row?.seq,row?.team);
}
export function installSimpleResults({document:d,getState,onEdit,onInclude,onWinner,onDetail,onSave,onFix}){
 const el=(tag,text='',cls='')=>{const n=d.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 const $=id=>d.getElementById(id);
 const style=el('style');style.textContent=`
 .simple-results #ssFixtureOverview,.simple-results #quickSummary,
 .simple-results #quickResetBulkReview,.simple-results #autoOutline,
 .simple-results #autoRegisterHeading,.simple-results #autoRegisterHelp,
 .simple-results #quickStatus,.simple-results #autoBeforeRun,
 .simple-results #quickTestHelp,.simple-results #workerBatchRun,
 .simple-results #workerBatchArea>p:first-child,
 .simple-results #workerBatchReadiness,.simple-results #workerBatchJumpToGoal,
 .simple-results #flowGuide{display:none!important}
 .simple-results:not(.simple-advanced) #legacyBatchDetails,
 .simple-results:not(.simple-advanced) #quickIndividualTestTools,
 .simple-results:not(.simple-advanced) #quickEdit,
 .simple-results:not(.simple-advanced) #individualFinishTools,
 .simple-results:not(.simple-advanced) #workerGateAudit{display:none!important}
 .simple-match{border:1px solid #567883;border-radius:14px;padding:14px;margin:14px 0;background:#102938}
 .simple-match h3{margin:0 0 8px;font-size:18px}
 .simple-score{font-size:20px;font-weight:700;margin:10px 0;overflow-wrap:anywhere}
 .simple-winners{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
 .simple-winners button{flex:1;min-width:90px;padding:12px 8px;font-size:14px}
 .simple-winners button[aria-pressed="true"]{background:#28765f;border:2px solid #9ce2c5}
 .simple-match .quick-goal{padding:12px 0;margin:0;border:0;border-top:1px solid #3d5966;border-radius:0;background:transparent}
 .simple-registered{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0}
 .simple-registered .small{flex:1}
 .simple-registered button{min-height:40px;padding:8px 13px}
 .simple-match .quick-field{font-size:13px}
 .simple-match .quick-field select{min-height:48px;font-size:16px}
 #simpleSaveArea[hidden]{display:none!important}
 #simpleSaveHelp{white-space:pre-wrap}
 `;d.head.append(style);
 const saveArea=el('div');saveArea.id='simpleSaveArea';saveArea.hidden=true;
 const save=el('button','保存','primary quick-main');save.type='button';save.id='simpleSave';
 const help=el('p','','small');help.id='simpleSaveHelp';help.setAttribute('role','status');help.setAttribute('aria-live','polite');
 const advanced=el('button','その他の操作','quick-exception');advanced.type='button';
 advanced.addEventListener('click',()=>{const open=d.body.classList.toggle('simple-advanced');advanced.textContent=open?'その他の操作を閉じる':'その他の操作'});
 save.addEventListener('click',()=>{if(!save.disabled)onSave()});
 saveArea.append(save,help,advanced);$('autoPanel').before(saveArea);
 const button=(label,fn,cls='quick-exception')=>{const b=el('button',label,cls);b.type='button';b.addEventListener('click',fn);return b};
 function select(row,field,label,options,value){
  const wrap=el('label','','quick-field');wrap.append(el('span',label));
  const menu=el('select');menu.setAttribute('aria-label','ゴール '+row.displayNumber+' '+label);
  for(const [v,text] of [['','選択してください'],...options]){const option=el('option',text);option.value=v;menu.append(option)}
  menu.value=String(value??'');menu.addEventListener('change',()=>{if(menu.value)onEdit(row.index,field,menu.value)});
  wrap.append(menu);return wrap;
 }
 function planFor(s,m){try{return analyzeAutoFixture(s.snapshot,s.rows,s.decisions,m.seq,s.winnerFor(m.seq))}catch(e){return {state:'blocked',reason:e.message}}}
 function render(){
  const s=getState();d.body.classList.toggle('simple-results',s.active);saveArea.hidden=!s.active;
  if(!s.active)return;
  $('quickPanel').querySelector('h2').textContent='得点・試合結果';
  const root=$('quickGoals');root.replaceChildren();
  const groups=new Map(),plans=new Map();
  for(const m of s.snapshot.matches){
   const card=el('section','','simple-match');card.dataset.seq=m.seq;
   card.append(el('h3',({1:'第1試合',2:'第2試合',3:'3位決定戦',4:'決勝'})[m.seq]||m.title));
   const p=planFor(s,m);plans.set(m.seq,p);
   const scored=['ready','winner-needed'].includes(p.state);
   // A blocked/unresolved draft is not a 0-0 result. Only show the official
   // finished score or a fully validated projection of all included goals.
   const left=scored?p.left:m.status==='finished'?m.leftScore:'—';
   const right=scored?p.right:m.status==='finished'?m.rightScore:'—';
   card.append(el('p',(m.leftTeam||'対戦未定')+'　'+left+' − '+right+'　'+(m.rightTeam||'対戦未定'),'simple-score'));
   card.append(el('p',m.status==='finished'?'保存済み':scored?'ゴールから計算したスコア':m.status==='waiting'?'準決勝の結果から対戦が決まります':'ゴールの入力を直すとスコアを表示します','small'));
   if(scored&&p.left===p.right){
    card.append(el('p',m.seq<3?'勝ち上がるチーム':'同点時の結果','small'));
    const choices=el('div','','simple-winners');
    for(const [value,label] of [['left',m.leftTeam+' 勝ち'],...(m.seq>=3?[['draw','引き分け']]:[]),['right',m.rightTeam+' 勝ち']]){
     const b=button(label,()=>onWinner(m,p,value),'');b.disabled=s.busy;
     b.setAttribute('aria-pressed',String(s.winnerFor(m.seq)===value));choices.append(b);
    }card.append(choices);
   }
   for(const registered of m.existingGoals||[]){
    const line=el('div','','simple-registered');
    line.append(el('span','⚽ '+registered.scorer+
     (registered.assist?' / '+registered.assist:''),'small'));
    if(m.status==='finished'&&s.snapshot.rosterSource==='official-current-event-teams'&&registered.id)
     line.append(button('修正',()=>onFix({seq:m.seq,goalId:registered.id})));
    card.append(line);
   }
   if(!(m.existingGoals||[]).length&&!s.rows.some(r=>r.include&&Number(r.seq)===m.seq))card.append(el('p','ゴールなし','small'));
   groups.set(m.seq,card);root.append(card);
  }
  for(const item of s.decisions){
   const row=s.rows[item.index],r={...row,index:item.index,displayNumber:item.index+1};
   let card=groups.get(Number(row.seq));
   if(!card){card=groups.get(0);if(!card){card=el('section','','simple-match');card.append(el('h3','試合を選んでください'));groups.set(0,card);root.append(card)}}
   const goal=el('div','','quick-goal');goal.id='quick-goal-'+r.displayNumber;goal.append(el('strong','ゴール '+r.displayNumber));
   // Display the original saved PeakStamp video observation, which is not
   // the same as a previously selected SS roster identity. Both remain
   // visible after an SS TEST score/fixture reset.
   const observed=row.goal||{};
   const heard=String(observed.scorer||'').trim()||'不明';
   const assistHeard=observed.assistStatus==='none'?'なし':
    observed.assistStatus==='named'?String(observed.assist||'').trim()||'不明':'未確認';
   if(!observed.manual)
    goal.append(el('p','動画保存：'+heard+' / アシスト '+assistHeard,'small'));
   if(row.previousGoalSelection){
    const prev=row.previousGoalSelection;
    goal.append(el('p','前回の選択：'+(prev.scorer||'不明')+
     (prev.assistMode==='named'?' / '+(prev.assist||'不明'):'')+
     '（試合・名簿を再確認）','small'));
   }else if(row.draftRestored){
    goal.append(el('p','前回の選択を復元しました','small'));
   }
   const uncertain=['attention','duplicate','manual-ss','patch','manual'].includes(item.state);
   const current=s.snapshot.matches.find(x=>x.seq===Number(row.seq));
   if(current?.status==='finished'&&!row.goal?.manual){
    // Finished match: a small two-field correction form replaces all
    // nested detail/JSON/preview panels. No full tournament re-registration.
    const desiredTeam=row.team||s.snapshot.playerTeam?.get(row.scorer)||'';
    const identical=(current.existingGoals||[]).filter(g=>
      g.scorer===row.scorer&&
      g.assist===(row.assistMode==='named'?row.assist:'')&&
      normalizeTeam(g.team)===normalizeTeam(desiredTeam));
    goal.append(button(identical.length===1?'登録済みを確認・修正':'ゴールを修正',
      ()=>onFix({seq:current.seq,rowIndex:item.index,
        goalId:identical.length===1?identical[0].id:''}),'primary'));
   }else if(!row.include){goal.append(el('p','今回の保存に含めません','small'),button('戻す',()=>onInclude(item.index,true)))}
   else if(row.goal?.manual||row.updateGoalId||row.guest||item.state==='duplicate'||item.state==='patch'){
    goal.append(el('p',(row.scorer||'得点者未選択')+' / '+(row.assistMode==='named'?row.assist:'アシストなし')));
    goal.append(el('p',item.state==='duplicate'?'同じ選手のゴールがあります。同じ得点か確認してください。':item.reason||'詳細入力が必要です','quick-held-note'));
    goal.append(button('内容を編集',()=>onDetail(item.index+1)));
   }else{
    const fields=el('div','','quick-fields'),reviewed=row.quickReviewedAll,rf=row.quickReviewedFields||{};
    if(!row.seq||row.fixtureIdentityChanged||(!reviewed&&!rf.match&&(row.matchGuess?.confidence!=='high'||row.matchGuess?.ambiguous||row.matchGuess?.conflict)))
     fields.append(select(r,'match','試合',s.snapshot.matches.map(m=>[String(m.seq),'第'+m.seq+'試合 '+(m.title||'')]),''));
    const m=s.snapshot.matches.find(m=>m.seq===Number(row.seq));
    const waitingReview=isWaitingKnockoutReview(s.snapshot,row);
    if(waitingReview){
     // The home team is an optional draft. If the speaker says a different
     // scoring side, the human can explicitly choose it. This never decides
     // the future 3rd-place/final opponents or authorizes a write.
     fields.append(select(r,'team','得点チーム（仮）',
      Object.keys(s.snapshot.roster||{}).map(t=>[t,t]),row.team));
    }
    // Show both sides ONLY when the same spoken nickname has multiple possible
    // people across the current fixture, including an AI-guessed wrong team.
    const players=scorerRosterForReview(s.snapshot,row).map(name=>
     [name,name+'　'+(s.snapshot.playerTeam.get(name)||'')]);
    const assistPlayers=assistRosterForReview(s.snapshot,row).map(name=>
     [name,name+'　'+(s.snapshot.playerTeam.get(name)||'')]);
    // Multiple plausible spoken-name matches must be explicitly chosen.
    // Prioritize the matching official roster candidates without hiding others.
    const choices=(hints,source=players)=>{const rank=new Map((hints||[]).map((x,i)=>[x.name,i]));
     return [...source].sort((a,b)=>(rank.get(a[0])??999)-(rank.get(b[0])??999));};
    const scorerAmbiguous=requiresSpokenNameChoice(row.scorerHints,players,rf.scorer,reviewed);
    if(scorerAmbiguous)fields.append(el('p','同じ呼び名の候補がいます。得点者を選んでください。','small'));
    fields.append(select(r,'scorer',scorerAmbiguous?'得点者（本人を選択）':'得点者',
     choices(row.scorerHints),scorerAmbiguous?'':row.scorer&&(reviewed||rf.scorer||row.scorerGuess?.confidence==='high')?row.scorer:''));
    const assistAmbiguous=row.assistMode==='named'&&
     requiresSpokenNameChoice(row.assistHints,assistPlayers,rf.assist,reviewed);
    if(assistAmbiguous)fields.append(el('p','アシストの候補が複数います。本人を選んでください。','small'));
    fields.append(select(r,'simpleAssist',assistAmbiguous?'アシスト（本人を選択）':'アシスト',
     [['__none__','なし'],...choices(row.assistHints,assistPlayers)],assistAmbiguous?'':row.assistMode==='none'?'__none__':row.assistMode==='named'&&(reviewed||rf.assist||row.assistGuess?.confidence==='high')?row.assist:''));
    if(!waitingReview&&(!row.team||item.helperPlan||item.state==='manual-ss')){
     const teams=[m?.leftTeam,m?.rightTeam].filter(Boolean);
     fields.append(select(r,'team','得点チーム',teams.map(t=>[t,t]),row.team));
    }
    goal.append(fields);if(uncertain)goal.append(el('p',item.reason,'quick-held-note'));
   }
   if(row.include)goal.append(button(item.state==='duplicate'?'同じ得点なので追加しない':'このゴールを除く',()=>onInclude(item.index,false)));
   card.append(goal);
  }
  const tie=[...plans].find(([,p])=>p.state==='winner-needed');
  const remaining=s.snapshot.matches.filter(m=>m.status!=='finished').length;
  save.textContent=remaining?(remaining===4?'4試合を保存':'残り'+remaining+'試合を保存'):'保存済み';
  save.disabled=s.busy||!s.canSave||Boolean(tie)||!remaining;
  help.textContent=tie?'第'+tie[0]+'試合の同点時の結果を選んでください。':s.canSave?'':remaining?s.blockReason:'';
  root.inert=s.busy;
 }
 return {render,setBusy(busy){if(busy)save.disabled=true;}};
}
