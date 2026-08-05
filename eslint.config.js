const js = require("@eslint/js");
const babelParser = require("@babel/eslint-parser");

// Flat config (ESLint v9+/v10). Mirrors the implement-js skill's intended
// ruleset, which was written for the legacy .eslintrc.json format.
module.exports = [
	{ ignores: ["node_modules/**", "frontend/dist/**", "coverage/**"] },
	js.configs.recommended,
	{
		files: ["src/**/*.js", "bin/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			parser: babelParser,
			parserOptions: {
				requireConfigFile: false
			},
			globals: {
				require: "readonly",
				module: "writable",
				process: "readonly",
				console: "readonly",
				Buffer: "readonly",
				fetch: "readonly",
				AbortSignal: "readonly",
				URL: "readonly",
				setTimeout: "readonly",
				setInterval: "readonly",
				clearTimeout: "readonly",
				clearInterval: "readonly",
				__dirname: "readonly"
			}
		},
		rules: {
			indent: ["error", "tab"],
			quotes: ["error", "double"],
			semi: ["error", "always"],
			"no-param-reassign": "error",
			"no-trailing-spaces": "error",
			"no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
		}
	},
	{
		// ESM Node entrypoints (bin/*.mjs — the MCP server).
		files: ["bin/**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			parser: babelParser,
			parserOptions: { requireConfigFile: false },
			globals: {
				process: "readonly",
				console: "readonly",
				fetch: "readonly"
			}
		},
		rules: {
			indent: ["error", "tab"],
			quotes: ["error", "double"],
			semi: ["error", "always"],
			"no-param-reassign": "error",
			"no-trailing-spaces": "error",
			"no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
		}
	},
	{
		// Frontend is ESM and runs in the browser (qrp); the .mjs verifier runs
		// under Node + happy-dom.
		files: ["frontend/**/*.js", "frontend/**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			parser: babelParser,
			parserOptions: { requireConfigFile: false },
			globals: {
				window: "readonly",
				document: "readonly",
				console: "readonly",
				process: "readonly",
				fetch: "readonly",
				setTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly"
			}
		},
		rules: {
			indent: ["error", "tab"],
			quotes: ["error", "double"],
			semi: ["error", "always"],
			"no-param-reassign": "error",
			"no-trailing-spaces": "error",
			"no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
		}
	},
	{
		// Root config files run in Node/CommonJS too.
		files: ["*.config.js", "babel.config.js"],
		languageOptions: {
			sourceType: "commonjs",
			globals: {
				require: "readonly",
				module: "writable",
				process: "readonly",
				__dirname: "readonly"
			}
		}
	},
	{
		files: ["**/__tests__/**/*.js"],
		languageOptions: {
			globals: {
				jest: "readonly",
				describe: "readonly",
				it: "readonly",
				test: "readonly",
				expect: "readonly",
				beforeEach: "readonly",
				afterEach: "readonly",
				beforeAll: "readonly",
				afterAll: "readonly"
			}
		}
	}
];
