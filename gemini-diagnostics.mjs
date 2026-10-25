/**
 * Collect explicitly user-shared analysis facts; no video, audio or credentials.
 */
export function buildAnalysisDiagnostic(source,geminiResult,goalReview){
 const raw=Array.isArray(geminiResult?.events)?geminiResult.events:[];
 const events=raw.map(e=>({
  reaction_time_seconds:e.reaction_time_seconds??null,
  type:String(e.type||''),confidence:String(e.confidence||''),
  quote:String(e.quote||''),audible_clue:String(e.audible_clue||''),
  suggested_clip_start_seconds:e.suggested_clip_start_seconds??null,
  suggested_clip_end_seconds:e.suggested_clip_end_seconds??null
 }));
 const byType={};
 for(const event of events)byType[event.type]=(byType[event.type]||0)+1;
 const candidates=(Array.isArray(source?.candidates)?source.candidates:[]).map(c=>({
  startSeconds:c.time??null,reactionSeconds:c.peakSeconds??null,
  kind:c.geminiType||c.origin||'acoustic_peak',
  confidence:c.geminiConfidence||null,
  score:Number.isFinite(c.score)?c.score:null,
  selected:c.enabled===true,rejected:c.rejected===true
 }));
 const goalItems=Array.isArray(goalReview?.items)?goalReview.items:[];
 const utterances=Array.isArray(goalReview?.transcript?.data?.utterances)
  ?goalReview.transcript.data.utterances:[];
 return JSON.stringify({
  kind:'peakstamp-analysis-diagnostic',version:1,
  source:{name:String(source?.file?.name||''),sizeBytes:Number(source?.file?.size||0),
   durationSeconds:Number(source?.duration||geminiResult?.duration_seconds||0)},
  analysisEngine:source?.analysisEngine||'unknown',
  gemini:{stored:!!geminiResult,segments:Number(geminiResult?.meta?.segments||0),
   rawEventCount:events.length,byType,events},
  editor:{candidateCount:candidates.length,candidates},
  goalReview:{explicitGoalCallCount:utterances.filter(x=>x?.kind==='goal_call').length,
   transcriptAvailable:!!goalReview?.transcript,
   draftCount:goalItems.length,
   confirmedCount:goalItems.filter(x=>x.status==='confirmed').length,
   manualCount:goalItems.filter(x=>x.origin==='manual').length,
   note:'Priority goal review receives explicit spoken goal calls and manual goals; generic Gemini goal_reaction scenes do not automatically become goal drafts.'}
 },null,2);
}
