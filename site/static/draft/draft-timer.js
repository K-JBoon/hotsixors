
export function createTimer({ onTick, onExpire, clock, scheduler }) {
  const now = clock ?? (() => Date.now());
  const schedule = scheduler ?? ((cb) => requestAnimationFrame(cb));

  let deadline = null;
  let armed = false;
  let stopped = false;

  function tick() {
    if (stopped) return;
    if (deadline === null) {
      schedule(tick);
      return;
    }
    const remaining = deadline - now();
    if (armed && remaining <= 0) {
      armed = false;
      try { onExpire(); } catch (e) { console.error(e); }
    } else if (armed) {
      try { onTick(remaining); } catch (e) { console.error(e); }
    }
    schedule(tick);
  }

  schedule(tick);

  return {
    setDeadline(d) {
      deadline = d;
      armed = d !== null;
    },
    stop() { stopped = true; },
  };
}
