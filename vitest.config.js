import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Sibling git worktrees (superpowers workflows create these under .claude/worktrees/ for
    // isolated feature branches) each carry their own full copy of src/**/*.test.js. Vitest's
    // default `exclude` doesn't know about them, so running `vitest run` from this checkout
    // silently picks up every worktree's tests too -- inflated, sometimes duplicated pass
    // counts with no signal that it happened. `exclude` replaces the default list rather than
    // extending it, so configDefaults.exclude is spread in explicitly to keep
    // node_modules/dist/etc. still excluded.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
