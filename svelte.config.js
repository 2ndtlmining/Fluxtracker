import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { CSP_DIRECTIVES, toKebabDirectives } from './src/lib/security/contentSecurityPolicy.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Use Node adapter for production deployment
		adapter: adapter({
			out: 'build',
			precompress: false,
			envPrefix: ''
		}),

		// Issue #125's CSP MUST be configured here, not set as a plain header in
		// hooks.server.js — see the incident note in contentSecurityPolicy.js. `mode: 'auto'`
		// lets SvelteKit pick nonce (dynamically-rendered responses, our case) or hash
		// (prerendered ones) and fold the right one into its own inline hydration-bootstrap
		// <script>, which a hand-set header has no way to do.
		csp: {
			mode: 'auto',
			directives: toKebabDirectives(CSP_DIRECTIVES)
		}
	}
};

export default config;