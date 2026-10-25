/**
 * Guided PeakStamp journey: short, actionable completion dialogs.
 * Neither this module nor any dialog action reloads the editor/MOV files.
 */
export function analysisCounts(sources=[],goalRows=[]){
 const goals=(goalRows||[]).filter(x=>x?.item?.status!=='excluded').length;
 const highlights=(sources||[]).reduce((n,s)=>
  n+(s.candidates||[]).filter(c=>!c.goalRecordId&&!c.goalVideoOwned).length,0);
 return {goals,highlights};
}
export function initJourneyCoach({
 document:doc=globalThis.document,
 actions={},counts=()=>({goals:0,highlights:0})
}={}){
 const $=id=>doc.getElementById(id);
 const root=$('journeyDialog'),headline=$('journeyDialogTitle'),
  message=$('journeyDialogBody'),primary=$('journeyDialogPrimary'),
  secondary=$('journeyDialogSecondary'),dismiss=$('journeyDialogDismiss');
 if(!root||!headline||!message||!primary||!secondary||!dismiss)
  throw Error('Journey dialog elements missing');
 let pending=null,goalIntroSeen=false,lastFocus=null;
 function close(){
  root.hidden=true;
  pending=null;
  lastFocus?.focus?.();
  lastFocus=null;
 }
 function show({title,body,main,other=null}){
  if(!root.hidden)close();
  lastFocus=doc.activeElement;
  headline.textContent=title;
  message.textContent=body;
  const wire=(button,action)=>{
   button.hidden=!action;
   if(action){
    button.textContent=action.label;
    button.onclick=()=>{
     // Close BEFORE executing navigation; keep Safari File objects intact.
     close();
     action.run?.();
    };
   }else button.onclick=null;
  };
  wire(primary,main);wire(secondary,other);
  root.hidden=false;
  primary.focus?.();
  pending={title,body};
 }
 dismiss.addEventListener('click',close);
 root.addEventListener('click',event=>{if(event.target===root)close();});
 doc.addEventListener?.('keydown',event=>{
  if(event.key==='Escape'&&!root.hidden){event.preventDefault?.();close();}
 });
 const reviewGoals=()=>{actions.goGoals?.();showGoalIntro();};
 const goHighlights=()=>actions.goHighlights?.();
 function showGoalIntro(){
  if(goalIntroSeen)return false;
  goalIntroSeen=true;
  show({
   title:'ゴールを確認しましょう',
   body:'① 動画を見て画角と切り取り秒数を調整。② AIが読み取った得点者・アシストを映像で確認して「得点情報を確定」。③ 最後に動画をキープ／不採用で次のゴールへ進みます。',
   main:{label:'ゴール一覧を開く',run:()=>actions.showGoalList?.()}
  });
  return true;
 }
 function analysisFinished({success=true,error='',failures=0}={}){
  const {goals,highlights}=counts();
  if(!success){
   show({
    title:'解析できませんでした',
    body:'解析を完了できませんでした。'+(error?'\n原因：'+String(error).slice(0,260):'')+
      '\n動画を読み込めるか・ネット接続・アクセスコードを確認して再解析してください。途中まで成功した区間は再利用できる場合があります。',
    main:{label:'解析画面に戻る',run:()=>actions.goAnalysis?.()}
   });
   return;
  }
  show({
   title:failures?'解析完了（一部失敗）':'解析が完了しました！',
   body:'ゴール '+goals+'件 ／ ハイライト '+highlights+'件を検出しました。'+
    (failures?'\n解析できなかった動画：'+failures+'本。後から再解析できます。':'')+
    '\n'+(goals?'まず「ゴール一覧」から映像を確認して、得点者・アシストを確定しましょう。':
     'ゴール候補はありません。ハイライトを確認するか、ゴールを手動追加してください。'),
   main:{label:goals?'⚽ ゴール一覧で確認':'🎞 ハイライトを確認',
    run:goals?reviewGoals:goHighlights},
   other:failures?{label:'失敗した動画を確認',run:()=>actions.goAnalysis?.()}:null
  });
 }
 function goalReviewFinished({total=0,unconfirmed=0}={}){
  show({
   title:'ゴール動画の判定が完了しました！',
   body:total+'件のゴール候補の動画を確認しました。'+
    (unconfirmed?'\n得点情報の未確定が'+unconfirmed+'件あります。必要なら一覧から確認してください。':'')+
    '\n次は通常ハイライトを確認しますか？',
   main:{label:'🎞 ハイライトへ進む',run:goHighlights},
   other:{label:'⚽ ゴールを振り返る',run:()=>{actions.goGoals?.();actions.showGoalList?.();}}
  });
 }
 function highlightReviewFinished({total=0,kept=0}={}){
  show({
   title:'ハイライトの確認が完了しました！',
   body:'候補 '+total+'件を確認し、'+kept+'件をキープしました。'+
    (kept?'\nもう一度すべて確認するか、動画の書き出しへ進んでください。':
     '\n動画を書き出すには、まずシーンを1件以上キープしてください。'),
   main:kept
    ?{label:'動画の書き出しへ',run:()=>actions.goExport?.()}
    :{label:'シーンをもう一度見る',run:()=>actions.reviewAllHighlights?.()},
   other:kept?{label:'シーンをもう一度見る',run:()=>actions.reviewAllHighlights?.()}:null
  });
 }
 function exportFinished(){
  show({
   title:'MP4の書き出しが完了しました！',
   body:'① 完成した動画を再生して確認。② iPhoneに保存。③「HS向けJSON」を保存して幹事にLINEなどで共有してください（Instagramリール制作に使用します）。',
   main:{label:'▶ 完成動画を確認',run:()=>actions.showExportPreview?.()},
   other:{label:'HS向けJSONを保存',run:()=>actions.saveHSJson?.()}
  });
 }
 function exportFailed(error){
  show({
   title:'動画を書き出せませんでした',
   body:String(error||'書き出しに失敗しました。').slice(0,300)+
    '\n画質を下げる、シーンを減らす、空き容量を確認するなどして再実行してください。',
   main:{label:'書き出し設定を確認',run:()=>actions.goExport?.()}
  });
 }
 return {show,close,isOpen:()=>!root.hidden,current:()=>pending,
  showGoalIntro,analysisFinished,goalReviewFinished,highlightReviewFinished,
  exportFinished,exportFailed};
}
