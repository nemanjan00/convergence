// Compile a flow's `inputs` templates into resolver functions. Templates use
// `{{ path }}` interpolation against a flow item's context (see FLOW_SPEC.md).
// Deliberately minimal — dotted access and array indexing only, no expressions
// — so the surface where a flow author (AI) can be wrong stays tiny.
//
//   compileInputs({ name: "{{ cert.san[0] }}" })  -> (ctx) => ({ name: "a.com" })
//
// Rules:
//   - a value that is exactly one placeholder resolves to the raw value
//     (array/object preserved), not its string form;
//   - a value mixing text and placeholders resolves to an interpolated string;
//   - a value with no placeholder is a constant;
//   - non-string values (numbers, bools, nested objects) recurse / pass through.

// Matches a whole-string single placeholder: "{{ path }}" and nothing else.
const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
// Matches every placeholder for interpolation.
const ANY = /\{\{\s*([^}]+?)\s*\}\}/g;
// A syntactically valid path: identifiers, dots, and [index] segments.
const VALID_PATH = /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*|\[\d+\])*$/;

// Split "cert.san[0].issuer" into ["cert","san","0","issuer"].
const pathSegments = (path) => {
	return path
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.filter((segment) => {
			return segment.length > 0;
		});
};

const template = {
	// Assert a path is syntactically valid, else throw (used by the validator).
	assertPath: (path) => {
		if (!VALID_PATH.test(path.trim())) {
			throw new Error("invalid template path: " + path);
		}

		return path.trim();
	},

	// Resolve a dotted/indexed path against ctx; missing -> null.
	resolvePath: (ctx, path) => {
		const segments = pathSegments(path.trim());

		return segments.reduce((value, segment) => {
			if (value === null || value === undefined) {
				return null;
			}

			const next = value[segment];

			return next === undefined ? null : next;
		}, ctx);
	},

	// Compile a single template value into (ctx) => resolvedValue.
	compileValue: (value) => {
		if (typeof value !== "string") {
			// Recurse into nested objects/arrays; pass scalars through.
			if (value && typeof value === "object") {
				return template.compileInputs(value);
			}

			return () => {
				return value;
			};
		}

		const whole = value.match(WHOLE);

		if (whole) {
			const path = template.assertPath(whole[1]);

			return (ctx) => {
				return template.resolvePath(ctx, path);
			};
		}

		if (value.indexOf("{{") === -1) {
			return () => {
				return value;
			};
		}

		// Mixed text + placeholders -> interpolated string. Validate each path.
		const paths = [];
		value.replace(ANY, (_match, path) => {
			paths.push(template.assertPath(path));
			return _match;
		});

		return (ctx) => {
			return value.replace(ANY, (_match, path) => {
				const resolved = template.resolvePath(ctx, path.trim());

				return resolved === null ? "" : String(resolved);
			});
		};
	},

	// Compile an inputs object/array into (ctx) => resolved object/array.
	compileInputs: (inputs) => {
		if (Array.isArray(inputs)) {
			const compiled = inputs.map((item) => {
				return template.compileValue(item);
			});

			return (ctx) => {
				return compiled.map((resolve) => {
					return resolve(ctx);
				});
			};
		}

		const compiled = {};

		Object.keys(inputs).forEach((key) => {
			compiled[key] = template.compileValue(inputs[key]);
		});

		return (ctx) => {
			const out = {};

			Object.keys(compiled).forEach((key) => {
				out[key] = compiled[key](ctx);
			});

			return out;
		};
	}
};

module.exports = template;
