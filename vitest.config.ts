import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Most of core is pure maths and runs fastest with no DOM at all; the few
    // files that need one (GPX parsing) opt in with a @vitest-environment
    // docblock.
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
