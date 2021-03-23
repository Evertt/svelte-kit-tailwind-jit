const { resolve } = require('path');
const { readFileSync } = require('fs');

const pkg = JSON.parse(readFileSync( './package.json'));
const sveltePreprocess = require("svelte-preprocess");
/** @type {import('@sveltejs/kit').Config} */
module.exports = {
	preprocess: [
		sveltePreprocess({
			defaults: {
				script: "typescript",
				style: "postcss",
			},
			postcss: true
		}),
	],
	kit: {
		adapter: require('@sveltejs/adapter-node')(),
		target: 'body',
		vite: {
			resolve: {
				alias: {
					$components: resolve('src/components')
				}
			},
			ssr: {
				noExternal: Object.keys(pkg.dependencies || {})
			}
		}
	}
};
