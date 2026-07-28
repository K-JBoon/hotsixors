
import { WISP_UNIT } from './sight.js';
export const COMPANION_COMMANDS = {
  RexxarMishaFocus: 'RexxarMisha',
  RexxarMishaCharge: 'RexxarMisha',
  RexxarMishaChargeRedirect: 'RexxarMisha',
  DryadWispRedirect: WISP_UNIT,
};

export const COMMANDED_KINDS = new Set(['pet', 'summon']);
export const PET_LEASH = 16.5;

export function sendCompanionsWhereTheyWereTold(model) {
  const commanded = model.companions.filter((c) => COMMANDED_KINDS.has(c.kind));
  if (!commanded.length) return;
  for (const p of model.players) {
    const orders = [];
    for (const c of p.casts) {
      const unitType = COMPANION_COMMANDS[(p.linkInfo[c.link] || {}).nameId];
      if (unitType && c.x != null) orders.push({ unitType, loop: c.loop, x: c.x, y: c.y });
    }
    if (!orders.length) continue;
    for (const body of commanded) {
      if (body.ownerId !== p.playerId) continue;
      for (const o of orders) {
        if (o.unitType !== body.unitType) continue;
        if (o.loop >= body.bornLoop && (body.diedLoop == null || o.loop <= body.diedLoop)) {
          body.moves.push({ loop: o.loop, x: o.x, y: o.y });
        }
      }
      body.moves.sort((a, b) => a.loop - b.loop);
    }
  }
}
