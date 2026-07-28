
const APP_ID = "hotsixors-draft";
const TRYSTERO_URL = "https://esm.sh/trystero@0.21/nostr";

export async function createNet({ lobbyCode, role, onCommand, onEvent, onPeers, onHostElection }) {
  const trystero = await import(TRYSTERO_URL);
  const { joinRoom, selfId } = trystero;
  const peerId = selfId;
  const room = joinRoom({ appId: APP_ID }, lobbyCode);
  const [sendCmd, getCmd] = room.makeAction("cmd");
  const [sendEvt, getEvt] = room.makeAction("event");

  let lastSeenSeq = -1;

  getCmd((msg, fromPeerId) => {
    try { onCommand(msg, fromPeerId); } catch (e) { console.error(e); }
  });

  getEvt((msg, fromPeerId) => {
    if (msg && typeof msg.seq === "number") {
      if (msg.seq <= lastSeenSeq) return;
      lastSeenSeq = msg.seq;
    }
    try { onEvent(msg, fromPeerId); } catch (e) { console.error(e); }
  });

  room.onPeerJoin?.((id) => onPeers?.({ kind: "join", peerId: id, peers: getPeerList() }));
  room.onPeerLeave?.((id) => {
    onPeers?.({ kind: "leave", peerId: id, peers: getPeerList() });
    onHostElection?.({ leavingPeerId: id, lastSeenSeq, selfPeerId: peerId });
  });

  function getPeerList() {
    try { return [peerId, ...Object.keys(room.getPeers?.() || {})]; }
    catch { return [peerId]; }
  }

  return {
    role,
    peerId,
    sendCommand: (msg, targetPeerId) => targetPeerId ? sendCmd(msg, targetPeerId) : sendCmd(msg),
    sendEvent: (msg, targetPeerId) => targetPeerId ? sendEvt(msg, targetPeerId) : sendEvt(msg),
    sendSnapshot: (snapshot) => sendEvt({ ...snapshot, kind: "snapshot" }),
    leave: () => room.leave?.(),
    getLastSeenSeq: () => lastSeenSeq,
    getPeers: () => getPeerList(),
  };
}
export function electHost(claims) {
  let best = null;
  for (const c of claims) {
    if (!best) { best = c; continue; }
    if (c.lastSeenSeq > best.lastSeenSeq) best = c;
    else if (c.lastSeenSeq === best.lastSeenSeq && c.peerId < best.peerId) best = c;
  }
  return best?.peerId ?? null;
}
