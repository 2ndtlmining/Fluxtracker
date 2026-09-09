import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: '0.0.0.0'
	},
	build: {
		rolldownOptions: {
			// vite-plugin-sveltekit-guard dominates plugin time on this project's ~3.8k
			// modules -- that's inherent to validating SvelteKit API usage at this size,
			// not something our config broke. The check is informational (build succeeds
			// either way), so it's off rather than trained-through noise (issue #101).
			// Re-check when bumping @sveltejs/kit/vite: if a newer guard implementation
			// shrinks the cost, this suppression can come back out.
			checks: { pluginTimings: false }
		}
	}
});
