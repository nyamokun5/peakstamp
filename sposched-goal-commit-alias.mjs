/**
 * TEST-only alias intentions, derived from an explicitly committed goal.
 * This module never performs network requests or changes a score.
 * A caller must first verify the goal write through the official SS readback.
 */
const clean = value => typeof value === 'string' ? value.trim() : '';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const norm = value => clean(value).normalize('NFKC').toLocaleLowerCase('ja-JP');

export function aliasIntentsForCommittedGoal({row, snapshot, goalVerified = false} = {}) {
 if (!goalVerified || !row || row.goal?.manual || row.guest ||
     snapshot?.rosterSource !== 'official-current-event-teams') return [];
 const intents = [];
 for (const [field, reviewed] of [['scorer', 'scorer'], ['assist', 'assist']]) {
  if (row.quickReviewedAll !== true && row.quickReviewedFields?.[reviewed] !== true)
   continue;
  if (field === 'assist' && row.assistMode !== 'named') continue;
  const alias = clean(row.goal?.[field==='scorer'?'rawScorer':'rawAssist'] ?? row.goal?.[field]); // immutable Gemini observation, NOT row[field]
  const person = clean(row[field]); // human-selected official roster name
  const member_id = snapshot.memberIds?.get(person);
  const team = snapshot.playerTeam?.get(person);
  if (!alias || !person || !uuid.test(member_id || '') || !team ||
      (row.team && row.team !== team)) continue;
  // Avoid teaching an unreviewed or ambiguous name from a prefill.
  intents.push({field, alias, person, member_id, team});
 }
 const seen = new Set();
 return intents.filter(intent => {
  const key = norm(intent.alias) + '|' + intent.member_id.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
 });
}

/**
 * Run after verified goal completion only. The injected writer must do an
 * official alias GET readback; unknown outcomes must never be retried blindly.
 * Return partial outcomes without changing goal registration success.
 */
export async function persistCommittedGoalAliases({intents, save} = {}) {
 const results = [];
 for (const intent of Array.isArray(intents) ? intents : []) {
  if (typeof save !== 'function') {
   results.push({intent, saved:false, uncertain:true, reason:'名寄せAPIが未接続です'});
   continue;
  }
  try {
   const result = await save(intent);
   results.push({intent, ...result,
    saved:result?.saved === true && result?.user_id === intent.member_id &&
      norm(result?.alias) === norm(intent.alias)});
  } catch {
   results.push({intent, saved:false, uncertain:true,
    reason:'名寄せの結果が不明です。再送せず公式データを確認してください'});
  }
 }
 return results;
}
