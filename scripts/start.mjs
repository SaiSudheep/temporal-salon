import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dependencies = [
  "tsx",
  "express",
  "@temporalio/client",
  "@temporalio/worker",
];
if (
  dependencies.some(
    (name) => !existsSync(path.join("node_modules", name, "package.json")),
  )
) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    console.error(
      "Run this launcher with npm start (npm.cmd start in Windows PowerShell).",
    );
    process.exit(1);
  }
  console.log("Installing dependencies for the first run...");
  const install = spawnSync(process.execPath, [npmCli, "ci"], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (install.error || install.status !== 0) {
    console.error(
      "Dependency installation failed.",
      install.error?.message ?? "",
    );
    process.exit(install.status || 1);
  }
}

await import("./dev.mjs");
