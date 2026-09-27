
import { decodeGameEvents } from '../protocol.js';
import { FIXED } from './stat-events.js';
import {
  applyControlGroupUpdate,
  applySelectionDelta,
  newSelection,
  splitTag,
  TAG_RECYCLE_SPAN,
} from './selection.js';
import { bodyAtLoopOf, ownerAtLoopOf } from './registry.js';
import { anchorSnapshot, isAliveAt } from './timeline.js';
const MOVE_LINK = 24;
const ATTACK_LINK = 26;
const CAMERA_FIXED = 256;
const CAMERA_MIN_GAP = 8;
const KEY_WINDOW_LOOPS = 4;
const REPEAT_CAST_LOOPS = 8;

const ATTACK_MOVE_KEY = 13;

export function runGamePass(data, protocol, model, reg) {
  const byUserId = new Map(model.players.filter((p) => p.userId != null).map((p) => [p.userId, p]));
  const ctx = {
    model,
    reg,
    bodyAtLoop: bodyAtLoopOf(reg),
    ownerAtLoop: ownerAtLoopOf(reg),
    lastKey: new Map(), // userId -> {key, loop}
    selections: new Map(), // userId -> {units, groups}
    zoom: new Map(), // userId -> camera distance, only sent when the player zooms
  };

  for (const ev of decodeGameEvents(data, protocol)) {
    const uid = ev._userid ? ev._userid.m_userId : null;
    const p = byUserId.get(uid);
    if (!p) continue;
    const handler = HANDLERS[ev._event];
    if (handler) handler(ctx, ev, p, uid);
  }
}

const HANDLERS = {
  // Locked Camera; players who have it may log no camera events at all
  'NNet.Game.SUserOptionsEvent': (ctx, ev, p, uid) => {
    if (ev.m_cameraFollow && !p.camera?.length) pushCamera(ctx, p, uid, ev._gameloop, null);
  },
  'NNet.Game.SCameraUpdateEvent': (ctx, ev, p, uid) => {
    if (ev.m_distance != null) ctx.zoom.set(uid, ev.m_distance / CAMERA_FIXED);
    if (ev.m_follow) pushCamera(ctx, p, uid, ev._gameloop, null);
    else if (ev.m_target) pushCamera(ctx, p, uid, ev._gameloop, ev.m_target);
  },
  'NNet.Game.STriggerKeyPressedEvent': (ctx, ev, p, uid) => {
    if (ev.m_flags === 8) ctx.lastKey.set(uid, { key: ev.m_key, loop: ev._gameloop });
  },
  'NNet.Game.SSelectionDeltaEvent': (ctx, ev, p, uid) => {
    applySelectionDelta(selectionOf(ctx, uid), ev.m_controlGroupId, ev.m_delta);
  },
  'NNet.Game.SControlGroupUpdateEvent': (ctx, ev, p, uid) => {
    applyControlGroupUpdate(selectionOf(ctx, uid), ev.m_controlGroupIndex, ev.m_controlGroupUpdate);
  },
  'NNet.Game.SCmdUpdateTargetPointEvent': (ctx, ev, p, uid) => {
    pushMove(ctx, p, uid, {
      loop: ev._gameloop,
      x: ev.m_target.x / FIXED,
      y: ev.m_target.y / FIXED,
    });
  },
  'NNet.Game.SCmdUpdateTargetUnitEvent': (ctx, ev) => {
    anchorSnapshot(ctx.bodyAtLoop, ev.m_target, ev._gameloop);
  },
  'NNet.Game.SCmdEvent': onCmd,
};

/* A follow sample (no target) keeps the camera on the hero until the next
   target sample. */
function pushCamera(ctx, p, uid, loop, target) {
  const cam = (p.camera ||= []);
  const last = cam[cam.length - 1];
  if (last && !last.follow === !!target && loop - last.loop < CAMERA_MIN_GAP) return;
  const d = ctx.zoom.get(uid);
  cam.push(target ? { loop, x: target.x / CAMERA_FIXED, y: target.y / CAMERA_FIXED, d } : { loop, follow: true, d });
}

function selectionOf(ctx, id) {
  let s = ctx.selections.get(id);
  if (!s) ctx.selections.set(id, (s = newSelection()));
  return s;
}
function selectedBodies(ctx, id, p, loop) {
  const s = ctx.selections.get(id);
  if (!s || !s.units.length) return null;
  const bodies = [];
  for (const t of s.units) {
    const body = ctx.reg.bodyByTag.get(splitTag(t));
    if (!body || (body !== p && body.ownerId !== p.playerId)) continue;
    if (isAliveAt(body.spans, loop)) bodies.push(body);
  }
  return bodies;
}
function pushMove(ctx, p, id, move) {
  if (!p.hasCompanions) {
    (p.moves ||= []).push(move);
    return;
  }
  const selected = selectedBodies(ctx, id, p, move.loop);
  for (const b of selected || [p]) (b.moves ||= []).push({ ...move });
}

function onCmd(ctx, ev, p, uid) {
  const point = ev.m_data && ev.m_data.TargetPoint;
  const asMove = () => {
    if (point) pushMove(ctx, p, uid, { loop: ev._gameloop, x: point.x / FIXED, y: point.y / FIXED });
  };
  if (!ev.m_abil) return asMove();
  const link = ev.m_abil.m_abilLink;
  if (link === MOVE_LINK) return asMove();

  const cast = { loop: ev._gameloop, link, index: ev.m_abil.m_abilCmdIndex };
  if (point) {
    cast.x = point.x / FIXED;
    cast.y = point.y / FIXED;
  }

  const unitTarget = ev.m_data && ev.m_data.TargetUnit;
  if (unitTarget) {
    const target = ctx.ownerAtLoop(Math.floor(unitTarget.m_tag / TAG_RECYCLE_SPAN), ev._gameloop);
    if (target) cast.targetPlayerId = target.playerId;
    if (unitTarget.m_snapshotPoint) {
      cast.x = unitTarget.m_snapshotPoint.x / FIXED;
      cast.y = unitTarget.m_snapshotPoint.y / FIXED;
    }
    anchorSnapshot(ctx.bodyAtLoop, unitTarget, ev._gameloop);
  }
  const lk = ctx.lastKey.get(uid);
  if (lk && ev._gameloop - lk.loop <= KEY_WINDOW_LOOPS) {
    cast.key = lk.key;
    ctx.lastKey.delete(uid);
  }
  if (point && (link === ATTACK_LINK || cast.key === ATTACK_MOVE_KEY)) asMove();

  const prev = p.casts && p.casts[p.casts.length - 1];
  if (prev && prev.link === link && ev._gameloop - prev.loop <= REPEAT_CAST_LOOPS) {
    prev.presses = (prev.presses || 1) + 1;
    if (cast.x != null) {
      prev.x = cast.x;
      prev.y = cast.y;
    }
    return;
  }
  (p.casts ||= []).push(cast);
}
