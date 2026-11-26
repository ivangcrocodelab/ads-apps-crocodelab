import { build } from "vite";
await build({
  configFile: false,
  build: {
    ssr: "scripts/maintenance-entry.ts",
    outDir: "build/maintenance",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "index.mjs" } },
  },
});
