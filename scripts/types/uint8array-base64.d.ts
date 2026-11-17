// TC39 Uint8Array base64/hex methods, used by @protontech/crypto sources.
interface Uint8Array<TArrayBuffer extends ArrayBufferLike> {
  toBase64(options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }): string;
  toHex(): string;
}

interface Uint8ArrayConstructor {
  fromBase64(
    string: string,
    options?: { alphabet?: "base64" | "base64url"; lastChunkHandling?: "loose" | "strict" | "stop-before-partial" },
  ): Uint8Array<ArrayBuffer>;
  fromHex(string: string): Uint8Array<ArrayBuffer>;
}
