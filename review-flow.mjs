/** Pure controls for reviewing audio-detected scenes in source-file order. */
export const DEFAULT_PLAY_LABEL = 'ナイスプレイ！';
export const PLAY_LABELS = Object.freeze([
  'ナイスプレイ！',
  'ゴール',
  'ナイスキーパー',
  '惜しい！',
  'ナイスディフェンス！',
]);

export function undecided(item) {
  return Boolean(item) && item.enabled !== true && item.rejected !== true;
}

export function orderedScenes(sources) {
  return (sources || []).filter(source => source.bins)
    .flatMap(source => (source.candidates || []).map(item => ({ source, item })));
}

export function visibleScenes(sources, tab = 'all') {
  return orderedScenes(sources).filter(({ item }) =>
    tab === 'kept' ? item.enabled === true : undecided(item));
}

/** Go forward to the next untouched candidate, wrapping back if needed. */
export function nextUndecided(sources, current) {
  const scenes = orderedScenes(sources);
  const at = scenes.findIndex(x => x.item === current);
  if (!scenes.length) return null;
  for (let i = 1; i < scenes.length; i++) {
    const candidate = scenes[(at + i + scenes.length) % scenes.length];
    if (undecided(candidate.item)) return candidate;
  }
  return null;
}

export function judgeScene(item, decision) {
  if (!item || !['kept','rejected'].includes(decision)) throw Error('無効な判定です');
  const previous = { enabled: item.enabled === true, rejected: item.rejected === true };
  item.enabled = decision === 'kept';
  item.rejected = decision === 'rejected';
  return previous;
}

export function restoreJudgment(item, previous) {
  if (!item || !previous) return;
  item.enabled = previous.enabled === true;
  item.rejected = previous.rejected === true;
}

export function replayBounds(source, item, getEnd) {
  const duration = Math.max(0, Number(source?.duration) || 0);
  const start = Math.min(duration, Math.max(0, Number(item?.time) || 0));
  const end = Math.max(start, Math.min(duration, Number(getEnd(source, item)) || 0));
  return { start, end };
}
