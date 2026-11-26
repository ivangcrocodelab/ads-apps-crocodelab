import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import process from "node:process";

const require = createRequire(import.meta.url);

if (process.env.SHOPIFY_REUSE_PRISMA_CLIENT === "1") {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const generated = readFileSync("node_modules/.prisma/client/schema.prisma", "utf8");
  const { Prisma } = require("@prisma/client");
  const { version } = require("prisma/package.json");
  if (schema !== generated || Prisma.prismaVersion.client !== version) {
    throw new Error("Prisma Client is outdated. Stop dev servers and run npm run setup before restarting them.");
  }
  console.log("Reusing the current Prisma Client for an additional dev server.");
} else {
  const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "generate"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
