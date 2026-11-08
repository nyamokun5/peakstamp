// A release event can arrive after a new export has already started.
export function holdExportScreen(showHelp) {
  let finished = false;
  let lock;
  const warn = () => { if (!finished) showHelp(); };
  async function request() {
    try {
      lock = await navigator.wakeLock.request('screen');
      if (finished) await lock.release();
      else lock.addEventListener('release', warn, { once: true });
    } catch { warn(); }
  }
  void request();
  return () => {
    finished = true;
    if (lock && !lock.released) void lock.release().catch(() => {});
  };
}
