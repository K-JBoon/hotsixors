(function () {
  "use strict";

  const scope = document.querySelector("[data-level-scope]");
  if (!scope) return;
  const slider = scope.querySelector("[data-level-slider]");
  const display = scope.querySelector("[data-level-display]");
  if (!slider) return;

  const targets = Array.from(scope.querySelectorAll(".storm-scale[data-base][data-scale]"));
  if (targets.length === 0) return;
  const STAT_CARD_SELECTOR = ".stat-card__value";
  const entries = targets.map(function (el) {
    const base = parseFloat(el.dataset.base);
    const scale = parseFloat(el.dataset.scale);
    const isPercent = el.dataset.percent === "true";
    const inStatCard = el.closest(STAT_CARD_SELECTOR) !== null;
    let decimals;
    if (el.dataset.decimals != null) {
      decimals = parseInt(el.dataset.decimals, 10);
    } else if (base >= 10 && Number.isInteger(base)) {
      decimals = 0;
    } else {
      decimals = 2;
    }
    return { el, base, scale, isPercent, decimals, inStatCard };
  });

  function format(value, decimals, isPercent) {
    const fixed = value.toFixed(decimals);
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
      const value = e.base * Math.pow(1 + e.scale, level);
      const formatted = format(value, e.decimals, e.isPercent);
      if (level === 0 && e.scale > 0 && !e.inStatCard) {
        const pct = Math.round(e.scale * 100);
        e.el.innerHTML = escape(formatted) + ' <span class="storm-scaling">(+' + pct + "% per level)</span>";
      } else {
        e.el.textContent = formatted;
      }
    }
  }

  slider.addEventListener("input", function () {
    const level = parseInt(slider.value, 10);
    apply(level);
  });

  apply(parseInt(slider.value, 10));
})();
