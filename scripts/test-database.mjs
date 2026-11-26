import { build } from "vite";
import { spawnSync } from "node:child_process";

if (!process.env.TEST_DATABASE_URL) {
  console.error(
    "Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL test database.",
  );
  process.exit(1);
}
await build({
  configFile: false,
  build: {
    ssr: "tests/all.ts",
    outDir: ".cache/database-tests",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "database.test.mjs" } },
  },
});
const result = spawnSync(
  process.execPath,
  ["--test", ".cache/database-tests/database.test.mjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "test-only-hmac-secret",
      SHOPIFY_APP_URL: "https://example.test",
      SCOPES: "read_products,write_app_proxy",
      CLICK_TOKEN_SECRET: "test-click-secret-000000000000000000000000",
      BONUS_RETENTION_SECRET: "test-bonus-secret-000000000000000000000000",
      OPERATOR_USER: "operator",
      OPERATOR_PASSWORD: "test-operator-password-000000000000000000000",
    },
  },
);
process.exit(result.status ?? 1);
