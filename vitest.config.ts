import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 85,
      },
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
