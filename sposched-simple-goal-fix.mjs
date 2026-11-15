import {fixturePlayerOptions, normalizeTeam} from './sposched-review-core.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const clean=x=>typeof x==='string'?x.trim():'';
const fail=message=>{throw Error(message)};
const same=(a,b)=>normalizeTeam(a)===normalizeTeam(b);
const nameOptions=(snapshot,seq,team='')=>fixturePlayerOptions(snapshot,seq,team);
export const currentMinimalGoalMatch=(snapshot,seq)=>
 snapshot?.matches?.find(m=>m.seq===Number(seq))||null;

/**
 * Browser-only draft. The Worker resolves SS player IDs, issues a signed
 * preview, rechecks its tenant and match, and journals one confirmed write.
 * No score, winner, team, player or SS goal identity may be inferred from the
 * text spoken in the video or from a previous fixture generation.
 */
export function makeMinimalGoalOperation({snapshot,seq,scorer,assist='',goalId='',row=null}={}){
 const m=currentMinimalGoalMatch(snapshot,seq);
 if(snapshot?.rosterSource!=='official-current-event-teams'||!m||
    !UUID.test(snapshot.eventId||'')||!UUID.test(m.matchId||'')||
    m.status!=='finished'||!m.leftTeam||!m.rightTeam)
  fail('最新のSS公式名簿と終了済み試合を再取得してください');
 if(!clean(scorer)||!nameOptions(snapshot,seq).includes(scorer))
  fail('得点者を現在の試合名簿から選んでください');
 const team=clean(snapshot.playerTeam?.get(scorer));
 if(![m.leftTeam,m.rightTeam].some(x=>same(x,team)))
  fail('得点者の所属と対戦チームが一致しません');
 if(assist&&(!nameOptions(snapshot,seq,team).includes(assist)||assist===scorer))
  fail('アシスト者は得点側の別の選手を選んでください');
 const event_id=snapshot.eventId,source=row?.goal?.source?.name||'SS登録済み';
 const fromPeakStamp={source,goalId:row?.goal?.id||goalId||'goal-fix',goalTimeSeconds:row?.goal?.goalTimeSeconds??null};
 if(goalId){
  if(!UUID.test(goalId))fail('SSゴールIDが不正です');
  const original=m.existingGoals?.find(g=>g.id===goalId);
  if(!original||original.ownGoal)fail('修正するSSゴールを再確認してください');
  if(!same(original.team,team))fail('得点チームの変更はこの画面では行えません');
  const patch={};
  if(clean(original.scorer)!==scorer)patch.scorer={name:scorer};
  if(clean(original.assist)!==clean(assist))patch.assist=assist?{name:assist}:null;
  if(!Object.keys(patch).length)fail('すでに同じ内容で登録されています');
  return {action:'patch_goal',args:{event_id,seq:m.seq,match_id:m.matchId,goal_id:goalId,patch},
   expected:{scorer:original.scorer,assist:original.assist||null,
    team:original.team,scored_at:original.scoredAt||null,own_goal:false},fromPeakStamp};
 }
 if((m.existingGoals||[]).some(g=>same(g.team,team)&&clean(g.scorer)===scorer&&clean(g.assist)===clean(assist)))
  fail('同じ選手・アシストのゴールが登録済みです。登録済みゴールから修正してください');
 // Adding to a finished match is safe only if it cannot contradict its
 // official winner. E.g. a 0-0 semifinal won by team3 becomes team3 1-0.
 const left=Number(m.leftScore),right=Number(m.rightScore);
 if(!Number.isInteger(left)||!Number.isInteger(right)||left<0||right<0||
    !['left','right','draw'].includes(m.winner))
  fail('終了済み試合の得点と勝者を検証できません。SS側で確認してください');
 const afterLeft=left+Number(same(team,m.leftTeam)),afterRight=right+Number(same(team,m.rightTeam));
 const predicted=afterLeft>afterRight?'left':afterRight>afterLeft?'right':'draw';
 if(predicted!=='draw'&&predicted!==m.winner||m.winner==='draw'&&predicted!=='draw')
  fail('この追加で試合の勝敗が変わります。SS側で試合結果を確認してください');
 return {action:'record_goal',args:{event_id,seq:m.seq,scorer,team,...(assist?{assist}:{})},fromPeakStamp};
}

export function installMinimalGoalFix({document:d,getState,onPreview,onExecute}){
 const el=(tag,text='',cls='')=>{const x=d.createElement(tag);x.textContent=text;if(cls)x.className=cls;return x;};
 const css=el('style');
 css.textContent=`
 #minimalGoalFix[hidden]{display:none!important}
 #minimalGoalFix{position:fixed;inset:0;z-index:100;background:#061521ee;
   display:flex;align-items:flex-end;justify-content:center}
 #minimalGoalFix .fix-sheet{width:min(100%,650px);max-height:94dvh;overflow:auto;
   padding:18px 16px calc(18px + env(safe-area-inset-bottom));border-radius:20px 20px 0 0;
   background:#142c3c;border:1px solid #7bb6aa;box-shadow:0 -8px 40px #0008}
 #minimalGoalFix h2{font-size:20px;margin:0 0 8px}
 #minimalGoalFix .fix-fields{display:grid;gap:12px;margin:18px 0}
 #minimalGoalFix label{display:flex;flex-direction:column;gap:6px;font-size:14px;color:#d6ebee}
 #minimalGoalFix select{min-height:52px;font-size:17px}
 #minimalGoalFix .fix-actions{display:flex;gap:8px}
 #minimalGoalFix .fix-actions button{flex:1;min-height:52px;font-size:16px}
 #minimalGoalFix .fix-status{white-space:pre-wrap;line-height:1.6;min-height:20px}
 #minimalGoalFix .fix-cancel{background:#224456}
 `;
 d.head.append(css);
 const overlay=el('div');overlay.id='minimalGoalFix';overlay.hidden=true;
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 overlay.setAttribute('aria-label','ゴールを修正');
 const sheet=el('section','','fix-sheet');overlay.append(sheet);
 d.body.append(overlay);
 let active=null,busy=false,prepared=null;
 const state=()=>getState();
 const setBusy=value=>{busy=value;overlay.inert=value;};
 const close=()=>{if(busy)return;active=null;prepared=null;overlay.hidden=true;sheet.replaceChildren();};
 const field=(name,options,current,onChange)=>{
  const wrap=el('label',name),sel=el('select');
  sel.setAttribute('aria-label','修正 '+name);
  for(const [value,title] of options){const opt=el('option',title);opt.value=value;sel.append(opt);}
  sel.value=current;
  sel.addEventListener('change',()=>onChange(sel.value));
  wrap.append(sel);return wrap;
 };
 const render=()=>{
  if(!active)return;
  prepared=null;
  const s=state(),m=currentMinimalGoalMatch(s.snapshot,active.seq);
  if(!m){close();return;}
  sheet.replaceChildren();
  sheet.append(el('h2',(active.goalId?'登録済みゴールを修正':'ゴールを追加')));
  sheet.append(el('p','第'+m.seq+'試合　'+m.leftTeam+' '+m.leftScore+'–'+m.rightScore+' '+m.rightTeam,'small'));
  const row=active.rowIndex!=null?s.rows[active.rowIndex]:null;
  if(row?.goal&&!row.goal.manual)
   sheet.append(el('p','動画：'+(row.goal.scorer||'不明')+' / アシスト '+(
    row.goal.assistStatus==='none'?'なし':row.goal.assist||'未確認'),'small'));
  const fields=el('div','','fix-fields');
  const persons=nameOptions(s.snapshot,m.seq).map(x=>[x,x+'　'+s.snapshot.playerTeam.get(x)]);
  fields.append(field('得点者',[['','選択してください'],...persons],active.scorer,value=>{
   active.scorer=value;active.assist='';render();
  }));
  const chosenTeam=s.snapshot.playerTeam?.get(active.scorer)||'';
  const assists=chosenTeam?nameOptions(s.snapshot,m.seq,chosenTeam).filter(x=>x!==active.scorer):[];
  fields.append(field('アシスト',[['','なし'],...assists.map(x=>[x,x])],active.assist,value=>{
   active.assist=value;render();
  }));
  sheet.append(fields);
  const status=el('p','','fix-status');status.setAttribute('role','status');sheet.append(status);
  const actions=el('div','','fix-actions');
  const cancel=el('button','戻る','fix-cancel');cancel.type='button';cancel.addEventListener('click',close);
  const save=el('button','保存','primary');save.type='button';
  save.addEventListener('click',async()=>{
   if(busy)return;
   try{
    if(!active.scorer)fail('得点者を選択してください');
    const current=state(),row=active.rowIndex!=null?current.rows[active.rowIndex]:null;
    const operation=makeMinimalGoalOperation({snapshot:current.snapshot,seq:active.seq,
     goalId:active.goalId,scorer:active.scorer,assist:active.assist,row});
    status.textContent='SSの最新データを確認しています…';
    setBusy(true);
    const result=await onPreview(operation);
    prepared={operation,...result};
    const summary=prepared.plan?.after;
    if(!summary||!prepared.preview_token||!prepared.action)fail('登録内容を確認できません');
    setBusy(false);
    status.textContent=(active.goalId?'変更':'追加')+'：'+
     (summary.scorer||active.scorer)+' / アシスト '+(summary.assist||'なし')+
     '\n第'+active.seq+'試合・'+(chosenTeam||'')+'（TEST）';
    save.textContent='この内容で登録';
    save.onclick=null;
    const newSave=save.cloneNode(true);
    save.replaceWith(newSave);
    newSave.addEventListener('click',async()=>{
     if(busy||!prepared)return;
     setBusy(true);
     status.textContent='SSに登録して照合しています…';
     try{
      await onExecute(prepared);
      setBusy(false);close();
     }catch(e){setBusy(false);prepared=null;status.textContent='登録を確認できません：'+e.message+
       '\n再送せずSSの最新データを確認してください。';
       newSave.disabled=true;}
    });
   }catch(e){setBusy(false);prepared=null;status.textContent=e.message;}
  });
  actions.append(cancel,save);sheet.append(actions);
 };
 return {
  open({seq,rowIndex=null,goalId=''}) {
   if(busy)return;
   const s=state(),m=currentMinimalGoalMatch(s.snapshot,seq);
   if(!s.testMode||!m||m.status!=='finished'||s.snapshot.rosterSource!=='official-current-event-teams')return;
   const row=rowIndex!=null?s.rows[rowIndex]:null;
   const registered=goalId?(m.existingGoals||[]).find(g=>g.id===goalId):null;
   if(goalId&&!registered)return;
   const desired=registered?.scorer||row?.scorer||'';
   const selected=nameOptions(s.snapshot,seq).includes(desired)?desired:'';
   const selectedTeam=s.snapshot.playerTeam?.get(selected)||'';
   const wantAssist=registered?.assist||row?.assistMode==='named'&&row?.assist||'';
   active={seq:Number(seq),rowIndex,goalId,
    scorer:selected,assist:nameOptions(s.snapshot,seq,selectedTeam).includes(wantAssist)?wantAssist:''};
   overlay.hidden=false;render();
  },
  close,
  get isOpen(){return !overlay.hidden}
 };
}
