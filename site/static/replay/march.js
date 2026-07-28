
import { LOOPS_PER_SECOND } from './analyze/stat-events.js';
function retime(run, perLoop, out) {
  const from = run[0];
  const to = run[run.length - 1];
  const cum = [0];
  for (let i = 1; i < run.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const travel = total / perLoop;
  const span = to.loop - from.loop;
  if (total === 0 || travel >= span) {
    for (let i = 1; i < run.length; i++) out.push(run[i]);
    return;
  }
  for (let i = 1; i < run.length - 1; i++) {
    out.push({ loop: from.loop + cum[i] / perLoop, x: run[i].x, y: run[i].y, via: true });
  }
  out.push({ loop: from.loop + travel, x: to.x, y: to.y, via: true, hold: true });
  out.push(to);
}
export function marchUnits(units, speeds) {
  if (!speeds) return;
  for (const unit of units) {
    if (!unit.anchors) continue;
    const speed = speeds[unit.type || unit.unitType];
    if (!speed) continue;
    const anchors = unit.anchors.filter((a) => !a.hold);
    if (anchors.length < 2) {
      unit.anchors = anchors;
      continue;
    }
    const perLoop = speed / LOOPS_PER_SECOND;
    const out = [anchors[0]];
    let run = [anchors[0]];
    for (let i = 1; i < anchors.length; i++) {
      run.push(anchors[i]);
      if (anchors[i].via) continue;
      retime(run, perLoop, out);
      run = [anchors[i]];
    }
    for (let i = 1; i < run.length; i++) out.push(run[i]);
    unit.anchors = out;
  }
}
