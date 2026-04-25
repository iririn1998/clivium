import { defineConfig } from "vitest/config";

// 各実装 .ts には同階層に対応する .test.ts（または .spec.ts）を1つ置く
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
  },
});
