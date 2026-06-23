import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    silent: "passed-only",
    typecheck: {
      checker: "tsc",
    },
    coverage: {
      reporter: ["text-summary", "json"],
      reportsDirectory: "coverage",
    },
  },
});
