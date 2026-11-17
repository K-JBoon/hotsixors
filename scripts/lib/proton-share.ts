// Read-only access to a public Proton Drive link through the official Drive SDK.
// openpgp exposes its "lightweight" build only under the browser export
// condition, so callers must run under `node --conditions=browser`.

import "@protontech/crypto/polyfill";
import { CryptoProxy } from "@protontech/crypto";
import { Api as CryptoApi } from "@protontech/crypto/proxy/endpoint/api.ts";
import { computeKeyPassword, generateKeySalt, getRandomSrpVerifier, getSrp } from "@protontech/crypto/srp";
import {
  MemoryCache,
  NullFeatureFlagProvider,
  OpenPGPCryptoWithCryptoProxy,
  ProtonDriveClient,
  type ProtonDriveHTTPClientBlobRequest,
  type ProtonDriveHTTPClientJsonRequest,
} from "@protontech/drive-sdk";

const APP_VERSION = process.env.PROTON_APP_VERSION ?? "web-drive@5.2.0";

export interface ShareNode {
  uid: string;
  name: string;
  type: "file" | "folder";
  size: number | undefined;
  modified: Date | undefined;
}

export interface ProtonShare {
  root: ShareNode;
  children(folder: ShareNode): Promise<ShareNode[]>;
  child(folder: ShareNode, name: string): Promise<ShareNode | undefined>;
  read(file: ShareNode): Promise<Uint8Array>;
}

function send(request: ProtonDriveHTTPClientJsonRequest | ProtonDriveHTTPClientBlobRequest, body?: BodyInit) {
  request.headers.set("x-pm-appversion", APP_VERSION);
  const timeout = AbortSignal.timeout(request.timeoutMs);
  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
  });
}

const httpClient = {
  fetchJson: (r: ProtonDriveHTTPClientJsonRequest) =>
    send(r, r.json ? JSON.stringify(r.json) : (r.body as BodyInit | undefined)),
  fetchBlob: (r: ProtonDriveHTTPClientBlobRequest) => send(r, r.body as BodyInit | undefined),
};

const srpModule = {
  getSrp: (Version: number, Modulus: string, ServerEphemeral: string, Salt: string, password: string) =>
    getSrp({ Version, Modulus, ServerEphemeral, Salt } as never, { password } as never),
  getSrpVerifier: (password: string) => getRandomSrpVerifier({ Modulus: "" } as never, { password } as never),
  computeKeyPassword,
  generateKeySalt,
};

const anonymous = new Proxy(
  {},
  { get: (_, key) => async () => { throw new Error(`anonymous session has no account.${String(key)}`); } },
);

const silentLogger = {
  debug() {},
  info() {},
  warn: (msg: string) => { if (process.env.PROTON_DEBUG) console.warn(msg); },
  error: (msg: string, error?: unknown) => console.error(msg, error ?? ""),
};

const unwrap = <T>(value: T | { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (value && typeof value === "object" && "ok" in value) {
    if (!value.ok) throw new Error(`proton: ${JSON.stringify(value.error)}`);
    return value.value;
  }
  return value as T;
};

function toNode(entity: any): ShareNode {
  const name = entity.name?.ok === false ? entity.name.error?.name : (entity.name?.value ?? entity.name);
  return {
    uid: entity.uid,
    name: String(name),
    type: entity.type === "folder" ? "folder" : "file",
    size: entity.activeRevision?.claimedSize ?? entity.activeRevision?.value?.claimedSize,
    modified: entity.modificationTime,
  };
}

export async function openShare(url: string): Promise<ProtonShare> {
  CryptoProxy.setEndpoint(new CryptoApi(), (endpoint: CryptoApi) => endpoint.clearKeyStore());
  const client = new ProtonDriveClient({
    httpClient,
    entitiesCache: new MemoryCache(),
    cryptoCache: new MemoryCache(),
    account: anonymous as never,
    openPGPCryptoModule: new OpenPGPCryptoWithCryptoProxy(CryptoProxy as never),
    srpModule: srpModule as never,
    featureFlagProvider: new NullFeatureFlagProvider(),
    telemetry: { getLogger: () => silentLogger, recordMetric() {} },
  });
  await client.experimental.getURLAccessInfo(url);
  const link = await client.experimental.authURLAccess(url, undefined, true);

  const children = async (folder: ShareNode) => {
    const out: ShareNode[] = [];
    for await (const entry of link.iterateFolderChildren(folder.uid)) out.push(toNode(unwrap(entry as any)));
    return out;
  };

  return {
    root: toNode(await link.getRootNode()),
    children,
    child: async (folder, name) => (await children(folder)).find((n) => n.name === name),
    async read(file) {
      const chunks: Uint8Array[] = [];
      const downloader = await link.getFileDownloader(file.uid);
      await downloader.downloadToStream(new WritableStream({ write: (chunk) => { chunks.push(chunk); } })).completion();
      return Buffer.concat(chunks);
    },
  };
}
