
function toBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(str) {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(str, "base64"));
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function urlSafe(b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafe(s) {
  return s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
}

export function encodeSnapshot(state) {
  const json = JSON.stringify(state);
  return urlSafe(toBase64(new TextEncoder().encode(json)));
}

export function decodeSnapshot(str) {
  const bytes = fromBase64(fromUrlSafe(str));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
