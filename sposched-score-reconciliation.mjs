/**
 * TEST score reconciliation contract.
 *
 * A score is an explicit final result, not a count of recognized video goals.
 * Pure validation only: never sends requests or authorizes writes.
 */
export function reconcileFinalScore({official, draft, goals = []}) {
  const valid = value => Number.isSafeInteger(value) && value >= 0;
  const pair = value => value && valid(value.left) && valid(value.right);
  if (!pair(official)) throw new Error('SSの現在のスコアを確認できません');
  if (!pair(draft)) throw new Error('スコアは0以上の整数で入力してください');
  if (!Array.isArray(goals)) throw new Error('ゴール明細が不正です');
  const goalIds = new Set();
  const counts = {left: 0, right: 0};
  for (const goal of goals) {
    if (!goal || !['left', 'right'].includes(goal.side))
      throw new Error('ゴールの得点チームを確認してください');
    if (typeof goal.id !== 'string' || !goal.id.trim())
      throw new Error('ゴールごとの識別子が必要です');
    if (goalIds.has(goal.id)) throw new Error('同じゴールが二重に含まれています');
    goalIds.add(goal.id);
    counts[goal.side]++;
  }
  if (counts.left > draft.left || counts.right > draft.right)
    throw new Error('ゴール明細が最終スコアを超えています');
  return {
    finalScore: {left: draft.left, right: draft.right},
    scoreChanged: official.left !== draft.left || official.right !== draft.right,
    attributedGoals: counts,
    unattributedGoals: {
      left: draft.left - counts.left,
      right: draft.right - counts.right
    }
  };
}
