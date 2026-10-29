import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "../../test/vitest/vitest.shared.config.ts";

// Preserve the complete Weaver seam suite without inheriting unrelated upstream projects.
export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: [
      "test/scripts/weaver-distribution-seams.test.ts",
      "test/scripts/weaver-mcp-client-journey.test.ts",
    ],
    passWithNoTests: false,
    allowOnly: false,
  },
});
