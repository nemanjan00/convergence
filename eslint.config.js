const js = require("@eslint/js");
const babelParser = require("@babel/eslint-parser");

// Flat config (ESLint v9+/v10). Mirrors the implement-js skill's intended
// ruleset, which was written for the legacy .eslintrc.json format.
module.exports = [
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
