import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disable CSS processing to avoid inheriting consumer repo's postcss config.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/index.ts",
        "src/domain/types.ts",
        "src/domain/index.ts",
      ],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 80,
        statements: 85,
      },
    },
  },
});
