// Frame cost averaged over half a second. `cpu` is the JS time of one frame:
// animation, culling and command submission. `gpu` needs
// EXT_disjoint_timer_query_webgl2, which most browsers hide behind a flag.
const WINDOW_MS = 500;

export function createFrameStats(renderer) {
  const gl = renderer.getContext();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let query = null;
  let started = 0;
  let sum = fresh(performance.now());
  let last = null;

  function fresh(at) {
    return { at, frames: 0, cpu: 0, worst: 0, shadowCpu: 0, gpu: 0, gpuFrames: 0, calls: 0, shadowCalls: 0, triangles: 0 };
  }

  // A restored context brings a new info and shadow map, so both are
  // looked up each frame.
  let wrapped = null;
  let renderShadows = null;

  function watch() {
    renderer.info.autoReset = false;
    if (wrapped === renderer.shadowMap) return;
    unwatch();
    wrapped = renderer.shadowMap;
    renderShadows = wrapped.render;
    wrapped.render = function (...args) {
      const calls = renderer.info.render.calls;
      const at = performance.now();
      renderShadows.apply(this, args);
      sum.shadowCpu += performance.now() - at;
      sum.shadowCalls += renderer.info.render.calls - calls;
    };
  }

  function unwatch() {
    if (wrapped) wrapped.render = renderShadows;
    wrapped = null;
  }

  function collect() {
    if (!pending.length) return;
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = pending.shift();
      if (!disjoint) {
        sum.gpu += gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6;
        sum.gpuFrames++;
      }
      gl.deleteQuery(done);
    }
  }

  function begin() {
    watch();
    renderer.info.reset();
    started = performance.now();
    if (timer && pending.length < 4) {
      query = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    }
  }

  function end() {
    const { info } = renderer;
    const now = performance.now();
    const cpu = now - started;
    if (query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pending.push(query);
      query = null;
    }
    if (timer) collect();
    sum.frames++;
    sum.cpu += cpu;
    sum.worst = Math.max(sum.worst, cpu);
    sum.calls += info.render.calls;
    sum.triangles += info.render.triangles;
    if (now - sum.at < WINDOW_MS) return;
    const n = sum.frames;
    last = {
      fps: (n * 1000) / (now - sum.at),
      cpu: sum.cpu / n,
      worst: sum.worst,
      shadowCpu: sum.shadowCpu / n,
      gpu: timer ? (sum.gpuFrames ? sum.gpu / sum.gpuFrames : null) : undefined,
      calls: Math.round(sum.calls / n),
      shadowCalls: Math.round(sum.shadowCalls / n),
      triangles: Math.round(sum.triangles / n),
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
    sum = fresh(now);
  }

  function dispose() {
    unwatch();
    renderer.info.autoReset = true;
    if (query) gl.endQuery(timer.TIME_ELAPSED_EXT);
    for (const q of [...pending, query]) if (q) gl.deleteQuery(q);
  }

  return { begin, end, read: () => last, dispose };
}

const ms = (v) => `${v.toFixed(2)} ms`;
const count = (v) => v.toLocaleString();

export function formatStats(stats, { width, height, pixelRatio }) {
  if (!stats) return 'Measuring…';
  const gpu = stats.gpu === undefined ? 'n/a (no timer query)' : stats.gpu === null ? 'pending' : ms(stats.gpu);
  const heap = performance.memory?.usedJSHeapSize;
  return [
    ['FPS', stats.fps.toFixed(1)],
    ['CPU frame', `${ms(stats.cpu)} (worst ${ms(stats.worst)})`],
    ['  shadow pass', ms(stats.shadowCpu)],
    ['GPU frame', gpu],
    ['Draw calls', `${count(stats.calls)} (shadow ${count(stats.shadowCalls)})`],
    ['Triangles', count(stats.triangles)],
    ['Programs', stats.programs],
    ['Geometries', count(stats.geometries)],
    ['Textures', count(stats.textures)],
    ['Buffer', `${width}×${height} @${pixelRatio}x`],
    ...(heap ? [['JS heap', `${Math.round(heap / 1e6)} MB`]] : []),
  ]
    .map(([label, value]) => `${label.padEnd(14)}${value}`)
    .join('\n');
}
