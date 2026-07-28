(function () {
  "use strict";

  const mount = document.querySelector("[data-underdog-calc]");
  if (!mount) return;

  const maxLevel = parseFloat(mount.dataset.maxLevel);
  const killXpBase = parseFloat(mount.dataset.killXpBase);
  const killXpOffset = parseFloat(mount.dataset.killXpOffset);
  const clampMin = parseFloat(mount.dataset.clampMin);
  const clampMax = parseFloat(mount.dataset.clampMax);
  const table = JSON.parse(mount.dataset.underdogTable);
  function bountyModifier(killer, victim) {
    const diff = victim - killer;
    const isNegative = diff < 0;
    const wholeGap = diff > -1 && diff < 1 ? 0 : Math.trunc(Math.abs(diff));
    const fraction = Math.abs(diff % 1);
    const row = table.find(function (r) { return r.levelGap === Math.min(wholeGap, table[table.length - 1].levelGap); });
    const delta = row.truncMod + fraction * 0.1 * row.moduloMod;
    const modifier = isNegative ? 1 - delta : 1 + delta;
    return Math.min(clampMax, Math.max(clampMin, modifier));
  }

  function formatNumber(value, decimals) {
    return value.toFixed(decimals).replace(/\.?0+$/, "");
  }

  mount.innerHTML =
    '<h3>Calculator</h3>' +
    '<div class="underdog-calc__fields">' +
    '<label>Killer team level <input data-calc-killer type="number" min="1" max="' + maxLevel + '" step="any" value="11.4" inputmode="decimal"></label>' +
    '<label>Victim team level <input data-calc-victim type="number" min="1" max="' + maxLevel + '" step="any" value="14.8" inputmode="decimal"></label>' +
    "</div>" +
    '<p class="underdog-calc__hint">Decimals are progress toward the next level: 12.5 = level 12, halfway to 13.</p>' +
    '<p class="underdog-calc__result" data-calc-result aria-live="polite"></p>';

  const killerInput = mount.querySelector("[data-calc-killer]");
  const victimInput = mount.querySelector("[data-calc-victim]");
  const result = mount.querySelector("[data-calc-result]");

  function update() {
    const killer = parseFloat(killerInput.value);
    const victim = parseFloat(victimInput.value);
    if (!isFinite(killer) || !isFinite(victim) || killer < 1 || victim < 1 || killer > maxLevel || victim > maxLevel) {
      result.textContent = "Enter levels between 1 and " + maxLevel + ".";
      return;
    }
    const modifier = bountyModifier(killer, victim);
    const xp = killXpBase * (Math.trunc(victim) + killXpOffset) * modifier;
    result.innerHTML =
      "Modifier <strong>×" + formatNumber(modifier, 3) + "</strong> — the kill grants <strong>" +
      formatNumber(xp, 1) + " XP</strong>";
  }

  killerInput.addEventListener("input", update);
  victimInput.addEventListener("input", update);
  update();
})();
