import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Resolve the `@/*` path alias (tsconfig.json paths) for tests, so unit tests can import
// application modules the same way as app code. Node test environment (pure logic + mocked
// Supabase clients); no jsdom needed for the current suites.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // docs/port/** ikut diuji: port kit di sana adalah fallback yang harus TETAP
    // jalan saat nanti ditempel ke repo lain, jadi ia tidak boleh membusuk diam-diam.
    include: ["src/**/*.test.ts", "docs/port/**/*.test.ts"],
  },
});
