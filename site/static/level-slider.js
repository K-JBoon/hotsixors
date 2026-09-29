(function () {
  "use strict";

  const scope = document.querySelector("[data-level-scope]");
  if (!scope) return;
  const slider = scope.querySelector("[data-level-slider]");
  const display = scope.querySelector("[data-level-display]");
  if (!slider) return;

  const targets = Array.from(scope.querySelectorAll(".storm-scale[data-base][data-scale]"));
  // Mana pools scale flat, not by a rate in the hero data. Their base is the level 1 value.
  const FLAT_PER_LEVEL = { "Mana": { perLevel: 10, decimals: 0 }, "Mana Regen": { perLevel: 0.09765625, decimals: 2 } };
  const flatEntries = [];
  for (const card of scope.querySelectorAll(".stat-card")) {
    const label = card.querySelector(".stat-card__label");
    const el = card.querySelector(".stat-card__value");
    const spec = label && el ? FLAT_PER_LEVEL[label.textContent.trim()] : null;
    if (!spec) continue;
    const base = parseFloat(el.textContent);
    // Gul'dan and Probius have no mana regen and do not gain any per level.
    if (!Number.isFinite(base) || base === 0) continue;
    flatEntries.push({ el, base: base - spec.perLevel, perLevel: spec.perLevel, decimals: spec.decimals });
  }
  if (targets.length === 0 && flatEntries.length === 0) return;
  const STAT_CARD_SELECTOR = ".stat-card__value";
  const entries = targets.map(function (el) {
    const base = parseFloat(el.dataset.base);
    const scale = parseFloat(el.dataset.scale);
    const isPercent = el.dataset.percent === "true";
    const perTick = "perTick" in el.dataset;
    const roundUp = el.dataset.round === "up";
    const inStatCard = el.closest(STAT_CARD_SELECTOR) !== null;
    let decimals;
    if (el.dataset.decimals != null) {
      decimals = parseInt(el.dataset.decimals, 10);
    } else if (base >= 10 && Number.isInteger(base)) {
      decimals = 0;
    } else {
      decimals = 2;
    }
    return { el, base, scale, isPercent, perTick, roundUp, decimals, inStatCard };
  });

  // Engine math is 20.12 fixed point. Each level-up truncates, and regen accrues per game tick.
  const FIXED_ONE = 4096;
  const TICKS_PER_SECOND = 16;
  const toFixedPoint = (x) => Math.round(x * FIXED_ONE) / FIXED_ONE;
  const truncFixedPoint = (x) => Math.floor(x * FIXED_ONE) / FIXED_ONE;

  function scaleByLevel(base, scale, level) {
    const factor = 1 + toFixedPoint(scale);
    let value = toFixedPoint(base);
    for (let i = 0; i < level; i++) value = truncFixedPoint(value * factor);
    return value;
  }

  function scaledValue(e, level) {
    if (!e.perTick) return scaleByLevel(e.base, e.scale, level);
    return scaleByLevel(e.base / TICKS_PER_SECOND, e.scale, level) * TICKS_PER_SECOND;
  }

  function format(value, decimals, isPercent, roundUp) {
    const step = Math.pow(10, decimals);
    const fixed = (roundUp ? Math.ceil(value * step - 1e-9) / step : value).toFixed(decimals);
    let out = fixed;
    if (decimals > 0) out = out.replace(/\.?0+$/, "");
    return isPercent ? out + "%" : out;
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function apply(level) {
    if (display) display.textContent = String(level);
    for (const e of entries) {
      const formatted = format(scaledValue(e, level), e.decimals, e.isPercent, e.roundUp);
      if (level === 0 && e.scale > 0 && !e.inStatCard) {
        const pct = Math.round(e.scale * 100);
        e.el.innerHTML = escape(formatted) + ' <span class="storm-scaling">(+' + pct + "% per level)</span>";
      } else {
        e.el.textContent = formatted;
      }
    }
    for (const e of flatEntries) {
      e.el.textContent = format(e.base + e.perLevel * level, e.decimals, false);
    }
  }

  slider.addEventListener("input", function () {
    const level = parseInt(slider.value, 10);
    apply(level);
  });

  apply(parseInt(slider.value, 10));
})();
