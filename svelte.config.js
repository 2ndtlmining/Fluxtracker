import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { CSP_DIRECTIVES, toKebabDirectives } from './src/lib/security/contentSecurityPolicy.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Use Node adapter for production deployment
		// `precompress` matters more than it looks (issue #246). adapter-node serves
		// everything under /_app/ with its own sirv instance, and that runs BEFORE the
		// handle hook in hooks.server.js -- so the runtime compression added in #242/#243
		// never sees a single static asset. With it off, the whole client bundle went to
		// the browser uncompressed: the 74,612-byte CSS came back with no content-encoding
		// at all, and a cold load pulled ~495 KB of JS and CSS in the clear while the HTML
		// and the API responses beside it were compressed.
		//
		// Turning it on emits .br and .gz next to every static asset at build time and
		// configures sirv to serve them. Better ratio than the runtime path -- build-time
		// brotli can afford quality 11, which is far too slow to do per request -- and no
		// per-request CPU at all.
		adapter: adapter({
			out: 'build',
			precompress: true,
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