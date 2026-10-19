/** Keep one HTMLVideoElement between scene cards for large local MOV files.
 * Reassign the source only when switching to a different source video.
 * No source bytes leave the browser. This module does not alter scene data.
 */
export function createSceneReplayMedia(makeVideo) {
  if (typeof makeVideo !== 'function') throw TypeError('makeVideo must be a function');
  let video = null;
  let activeSource = null;
  return {
    acquire(sourceId, sourceUrl) {
      if (!sourceId || !sourceUrl) throw Error('動画の参照先がありません。');
      if (!video) {
        video = makeVideo();
        video.preload = 'metadata';
      }
      const sourceChanged = activeSource !== sourceId;
      if (sourceChanged) {
        video.pause();
        video.src = sourceUrl;
        video.load();
        activeSource = sourceId;
      }
      return { video, sourceChanged };
    },
    release() {
      if (!video) return;
      video.pause();
      video.remove();
    },
    dispose() {
      if (!video) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      video = null;
      activeSource = null;
    }
  };
}
