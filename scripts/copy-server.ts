import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { REPO_ROOT, saveEntry, scanRegistry, type CopyEntry } from "./lib/copy-registry.ts";
import { runScript } from "./lib/script.ts";

export const COPY_PORT = Number(process.env.COPY_PORT ?? 1112);

const CLIENT = path.join(REPO_ROOT, "scripts/lib/copy-edit-client.js");
const TSX = path.join(REPO_ROOT, "node_modules/.bin/tsx");

let queue: Promise<unknown> = Promise.resolve();

/** Serializes saves so a regen never overlaps the next edit. */
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

function regen(task: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [path.join(REPO_ROOT, "scripts", `${task}.ts`)], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${task} exited with ${code}`))));
  });
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<{ id?: string; expected?: string; text?: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}

async function handleSave(body: { id?: string; expected?: string; text?: string }): Promise<{ entry: CopyEntry; regen: string | null }> {
  const { id, expected, text } = body;
  if (typeof id !== "string" || typeof expected !== "string" || typeof text !== "string") {
    throw new Error("save needs id, expected and text");
  }
  const entry = await saveEntry(id, expected, text);
  if (entry.regen) await regen(entry.regen);
  return { entry, regen: entry.regen ?? null };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${COPY_PORT}`);
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  if (url.pathname === "/copy-edit.js") return send(res, 200, await readFile(CLIENT, "utf-8"), "text/javascript");
  if (url.pathname === "/registry") return send(res, 200, { entries: await scanRegistry() });
  if (url.pathname === "/save" && req.method === "POST") {
    const body = await readBody(req);
    return send(res, 200, await serialize(() => handleSave(body)));
  }
  send(res, 404, { error: "not found" });
}

export function startCopyServer(port = COPY_PORT): Server {
  const server = createServer((req, res) => {
    route(req, res).catch((error: Error) => send(res, 400, { error: error.message }));
  });
  server.listen(port, "127.0.0.1", () => console.log(`copy: edit server on http://127.0.0.1:${port}`));
  return server;
}

runScript(import.meta.url, async () => {
  startCopyServer();
  await new Promise(() => {});
});
