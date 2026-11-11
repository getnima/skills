import { defineConfig } from 'vitest/config';

// Server / shared logic only: plain node, no vite client plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
