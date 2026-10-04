import { defineConfig } from "vitest/config";

// Preserve the complete Weaver seam suite without inheriting unrelated upstream projects.
export default defineConfig({
  test: {
    include: ["test/scripts/weaver-distribution-seams.test.ts"],
    passWithNoTests: false,
    allowOnly: false,
  },
});
