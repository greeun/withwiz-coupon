import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".cjs",
    };
  },
  dts: true,
  sourcemap: false,
  splitting: false,
  clean: true,
  minify: false,
  treeshake: true,
  target: "node18",
  platform: "node",
  external: ["@prisma/client"],
});
