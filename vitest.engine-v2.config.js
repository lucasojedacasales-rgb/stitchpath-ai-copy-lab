import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/lib/engineV2/__tests__/**/*.test.js',
      'src/components/diagnostic/__tests__/EngineV2AuditPanel.test.js',
    ],
  },
});
