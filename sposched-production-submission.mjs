// Local, production-only submission identities. Fingerprints detect changed
// drafts; they are NOT credentials, signatures or authorization to write.
import {normalizePerson,normalizeTeam} from './sposched-review-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=()=>{throw Error('本番の送信済みゴール情報を照合できません。再送せず確認してください');};
export const productionSubmissionKey=eventId=>'peakstamp:production:submission-v1:'+eventId;
const reviewOf=r=>({seq:Number(r?.seq),team:String(r?.team||''),scorer:String(r?.scorer||''),
 assist:String(r?.assist||''),assistMode:r?.assistMode||'unknown',
 guest:r?.guest===true,include:r?.include!==false});
export const manualReviewFingerprint=review=>JSON.stringify(reviewOf(review));
const goalTuple=g=>JSON.stringify([Number(g.seq),normalizeTeam(g.team),normalizePerson(g.scorer),normalizePerson(g.assist)]);
function validate(record,eventId,requestId){
 if(record?.version!==1||!UUID.test(eventId||'')||!UUID.test(requestId||'')||
    !UUID.test(record.team_id||'')||record.event_id!==eventId||record.request_id!==requestId||
    record.plan?.event_id!==eventId||record.plan?.request_id!==requestId||
    record.plan.confirm!=='PRODUCTION EVENT BATCH WRITE'||
    record.plan_fingerprint!==JSON.stringify(record.plan)||!Array.isArray(record.plan.operations)||
    !Array.isArray(record.manual)||record.manual.length>20)fail();
 if(record.manual.length&&record.plan.layout_mode!=='independent-fixtures-v1')fail();
 const ids=new Set();
 for(const item of record.manual){
  if(!UUID.test(item?.id||'')||item.key!=='SS手動入力::'+item.id||ids.has(item.id)||
    item.fingerprint!==manualReviewFingerprint(item.review)||
    record.plan.operations.filter(o=>o.action==='create'&&goalTuple(o)===goalTuple({...item.review,
     assist:item.review.assistMode==='named'?item.review.assist:''})).length!==1)fail();
  ids.add(item.id);
 }
 return record;
}
export function makeProductionSubmission({plan,rows,teamId}){
 const manual=[];
 for(const row of rows||[]){
  if(row?.goal?.manual!==true||!row.include)continue;
  if(row.goal.sent!==false||row.key!=='SS手動入力::'+row.goal.id)fail();
  const review=reviewOf(row);
  manual.push({id:row.goal.id,key:row.key,review,fingerprint:manualReviewFingerprint(review)});
 }
 // JSON copy freezes the reviewed identity independently of later row edits.
 const record=JSON.parse(JSON.stringify({version:1,event_id:plan.event_id,request_id:plan.request_id,team_id:teamId,
  plan,plan_fingerprint:JSON.stringify(plan),manual}));
 return validate(record,plan.event_id,plan.request_id);
}
export function storeProductionSubmission(storage,record){
 validate(record,record.event_id,record.request_id);
 storage.setItem(productionSubmissionKey(record.event_id),JSON.stringify(record));
}
export function readProductionSubmission(storage,eventId,requestId){
 const raw=storage.getItem(productionSubmissionKey(eventId));
 // Legacy request markers have no receipt: never guess which drafts they sent.
 if(raw===null)return null;
 let record;try{record=JSON.parse(raw)}catch{fail()}
 return validate(record,eventId,requestId);
}
export function verifyProductionSubmission(record,state,fresh){
 validate(record,state?.event_id,state?.request_id);
 if(state.status!=='completed'||fresh?.eventId!==record.event_id)fail();
 if(!record.manual.length)return true;
 // Manual production batches currently use only the independent fixture
 // contract. Require full official score + scorer + assist readback, not merely
 // a completed flag or a matching fixture count.
 if(record.plan.layout_mode!=='independent-fixtures-v1'||
    fresh.matches?.length!==record.plan.fixture_count)fail();
 for(const match of fresh.matches){
  const operations=record.plan.operations.filter(o=>o.seq===match.seq);
  const finish=operations.filter(o=>o.action==='finish');
  const goals=operations.filter(o=>o.action==='create');
  if(finish.length!==1||match.status!=='finished'||
    match.matchId?.toLowerCase()!==finish[0].expected_match_id?.toLowerCase()||
    !Array.isArray(match.existingGoals)||match.existingGoals.length!==goals.length)fail();
  const actual=match.existingGoals.map(g=>{
   if(g.ownGoal)fail();
   return goalTuple({...g,seq:match.seq});
  }).sort();
  if(JSON.stringify(actual)!==JSON.stringify(goals.map(goalTuple).sort()))fail();
  const left=goals.filter(g=>normalizeTeam(g.team)===normalizeTeam(match.leftTeam)).length;
  const right=goals.filter(g=>normalizeTeam(g.team)===normalizeTeam(match.rightTeam)).length;
  if(left+right!==goals.length||match.leftScore!==left||match.rightScore!==right)fail();
 }
 return true;
}
export function reconcileProductionManualGoals(goals,record,eventId,requestId){
 if(!record)return {goals,completedKeys:[]};
 validate(record,eventId,requestId);
 const submitted=new Map(record.manual.map(item=>[item.id,item]));
 const completedKeys=[];
 const next=goals.map(goal=>{
  const item=submitted.get(goal.id);
  if(!item||goal.manual!==true||goal.sent===true||!goal.review||
     item.fingerprint!==manualReviewFingerprint(goal.review))return goal;
  completedKeys.push(item.key);return {...goal,sent:true};
 });
 return {goals:next,completedKeys};
}
