import { spawn } from "node:child_process";
import { bundleClient } from "./lib/bundle.ts";
import { startCopyServer } from "./copy-server.ts";

await bundleClient({ watch: true });
const copy = startCopyServer();

const zola = spawn("zola", ["--root", "site", "serve"], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    copy.close();
    zola.kill(signal);
  });
}
zola.on("exit", (code) => {
  copy.close();
  process.exit(code ?? 0);
});
