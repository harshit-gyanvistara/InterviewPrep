import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic in lib/. Component tests would need jsdom + @vitejs/plugin-react
// (see node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md); add them when needed.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "liveAgent/**"],
    coverage: {
      provider: "v8",
      include: ["lib/recommend.ts", "lib/analysis.ts", "lib/packs.ts", "lib/schemas.ts", "lib/route.ts"],
      thresholds: { lines: 80 },
    },
  },
});
