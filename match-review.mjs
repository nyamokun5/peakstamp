import { matchStorageKey } from './match-label.mjs';
import { createGoalDrafts, saveGoalDrafts, goalSourceKey, GOAL_STORE_PREFIX } from './goal-stats.mjs?v=matchrecover2';

const cardKey = source => 'peakstamp_card_v1:' + matchStorageKey(source);
export function confirmedCard(source, storage) {
  try {
    const card = JSON.parse(storage.getItem(cardKey(source)));
    return card?.seq === source.matchNumber && card.a && card.b ? card : null;
  } catch { return null; }
}
export function applyCard(item, card) {
  if (!card) return item;
  return {...item, matchSeq:String(card.seq), teamA:card.a, teamB:card.b,
    matchLabel:card.a+' 対 '+card.b, sourceMatchSeqAutofill:false,
    userEditedGoalFields:[...new Set([...(item.userEditedGoalFields || []),'teamA','teamB','matchSeq','matchLabel'])]};
}
function candidateTeams(source, storage) {
  const saved = confirmedCard(source, storage);
  if (saved) return [[saved.a,saved.b]];
  const {items, transcript} = createGoalDrafts(source, storage);
  const events = (transcript?.data?.utterances || []).filter(e=>e.kind==='match_start');
  const team = /^(?:チーム\s*|team\s*)?[1-9]\d?$|^(?:赤|青|白|黄|緑|黒|橙|オレンジ|ピンク|紫)(?:チーム)?$/i;
  return [...events,...items].flatMap(row=>{
    let a = row.team_a || row.teamA, b = row.team_b || row.teamB;
    const pair = String(row.match_label || row.matchLabel || '').normalize('NFKC').split(/\s*(?:対|vs\.?)\s*/i);
    if (pair.length===2) { a ||= pair[0]; b ||= pair[1]; }
    a = String(a||'').normalize('NFKC').trim();
    b = String(b||'').normalize('NFKC').trim();
    return team.test(a) || team.test(b) ? [[team.test(a)?a:'',team.test(b)?b:'']] : [];
  });
}
export function showMatchReview(sources, storage, done) {
  const dialog = document.getElementById('matchReview');
  const rows = dialog.querySelector('fieldset');
  rows.replaceChildren();
  const grouped = new Map();
  for (const source of sources) {
    if (!grouped.has(source.matchNumber)) grouped.set(source.matchNumber, []);
    grouped.get(source.matchNumber).push(source);
  }
  const entries = [];
  for (const [seq, group] of grouped) {
    const candidates = group.flatMap(src=>candidateTeams(src,storage));
    const line = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = '第'+seq+'試合'; line.append(title);
    const inputs = ['チームA','チームB'].map((name,i)=>{
      const values = new Set(candidates.map(pair=>pair[i]).filter(Boolean));
      const input = document.createElement('input');
      input.placeholder = name; input.required = true; input.maxLength=40;
      input.setAttribute('aria-label', title.textContent+' '+name);
      if (values.size===1) input.value = [...values][0];
      if(i) line.append(' 対 ');
      line.append(input); return input;
    });
    rows.append(line); entries.push({seq,group,inputs});
  }
  dialog.querySelector('output').textContent='';
  dialog.querySelector('form').onsubmit = event=>{
    event.preventDefault();
    const staged = [];
    for (const {seq,group,inputs} of entries) {
      const [a,b] = inputs.map(input=>input.value.trim());
      if (!a || !b || a===b) {
        dialog.querySelector('output').textContent='第'+seq+'試合の両チームを確認してください。';
        return;
      }
      for (const src of group) staged.push({src,card:{seq,a,b}});
    }
    const previous = new Map();
    try {
      for (const {src,card} of staged) {
        for (const key of [cardKey(src), GOAL_STORE_PREFIX+goalSourceKey(src)]) previous.set(key,storage.getItem(key));
        const {items} = createGoalDrafts(src,storage);
        if (items.length && !saveGoalDrafts(src,storage,items.map(item=>applyCard(item,card)))) throw Error();
        storage.setItem(cardKey(src),JSON.stringify(card));
      }
    } catch {
      for (const [key,value] of previous) {
        try { if(value===null) storage.removeItem(key); else storage.setItem(key,value); } catch {}
      }
      dialog.querySelector('output').textContent='保存できませんでした。空き容量を確認して再度お試しください。'; return;
    }
    dialog.close(); done();
  };
  dialog.showModal();
}
