// Block: regex — a declarative regex parser. Turns any text blob (a banner, a
// WHOIS record, response headers, an HTML page, cli stdout) into typed fields by
// a `fields: { name => pattern }` map. Pure, no network — the structured-
// extraction companion to `map` (which walks JSON) and the `cli`/`http.request`
// blocks (which produce the raw text).
//
//   inputs:
//     text: "{{ host.banner }}"          # or `value`
//     fields:
//       # string spec -> first match, capture group 1 (or whole match):
//       server:  "Server:\\s*(.+)"
//       # object spec -> flags / explicit group / all-matches / nested parser:
//       emails:  { pattern: "[\\w.+-]+@[\\w.-]+", all: true }        # -> array
//       versions:{ pattern: "v(\\d+\\.\\d+)", group: 1, all: true }
//       # NESTED: parse each match with a sub-map -> array of objects:
//       hosts:   { pattern: "\\S+ \\d+", all: true,
//                  parser: { name: "(\\S+) ", port: " (\\d+)" } }
//       # DYNAMIC KEY/VALUE: one pattern, two groups -> { key: value } object
//       # (named groups (?<key>)/(?<value>) or keyGroup/valueGroup also work):
//       headers: { pattern: "^([\\w-]+):\\s*(.+)$", flags: "m", pairs: true }
//
// Tolerant: a bad pattern or a field that doesn't match is simply omitted; a
// totally unmatched / empty input yields {}.

// Compile a field spec (string or object) — extract its value(s) from `text`.
// Recurses when the spec carries a nested `parser` map.
const extract = (text, spec) => {
	const isObject = spec && typeof spec === "object";
	const pattern = isObject ? spec.pattern : spec;

	if (!pattern) {
		return undefined;
	}

	const flags = (isObject && spec.flags) || "";
	const wantMany = isObject && (spec.all || spec.pairs);

	// Iterating all matches needs the global flag; add it only for many-mode.
	const useFlags = (wantMany && flags.indexOf("g") === -1) ? flags + "g" : flags;
	const re = new RegExp(pattern, useFlags);

	// Which slice of a match is the value: explicit group, else first capture
	// group if the pattern has one, else the whole match.
	const valueOf = (match) => {
		if (isObject && spec.group !== undefined) {
			return match[spec.group];
		}

		return match.length > 1 ? match[1] : match[0];
	};

	if (!wantMany) {
		const match = re.exec(text);

		if (!match) {
			return undefined;
		}

		if (isObject && spec.parser) {
			return extractMap(match[0], spec.parser);
		}

		return valueOf(match);
	}

	// Dynamic key/value pairs -> one object.
	if (isObject && spec.pairs) {
		const out = {};
		let match = re.exec(text);

		while (match !== null) {
			if (match.index === re.lastIndex) { re.lastIndex = re.lastIndex + 1; }

			const key = (match.groups && match.groups.key) !== undefined
				? match.groups.key
				: match[spec.keyGroup || 1];
			const value = (match.groups && match.groups.value) !== undefined
				? match.groups.value
				: match[spec.valueGroup || 2];

			if (key !== undefined) {
				out[key] = value;
			}

			match = re.exec(text);
		}

		return Object.keys(out).length > 0 ? out : undefined;
	}

	// All matches -> an array of values, or of nested objects when a sub-parser
	// is given.
	const out = [];
	let match = re.exec(text);

	while (match !== null) {
		if (match.index === re.lastIndex) { re.lastIndex = re.lastIndex + 1; }

		out.push(spec.parser ? extractMap(match[0], spec.parser) : valueOf(match));

		match = re.exec(text);
	}

	return out.length > 0 ? out : undefined;
};

// Apply a whole `{ name => spec }` map to a text, per-field tolerant so one bad
// pattern can't drop the others.
const extractMap = (text, map) => {
	const fields = {};

	Object.keys(map).forEach((name) => {
		try {
			const value = extract(String(text), map[name]);

			if (value !== undefined) {
				fields[name] = value;
			}
		} catch {
			// skip this field on a bad pattern; the rest still parse
		}
	});

	return fields;
};

module.exports = {
	uses: "regex",
	rate: {},
	example: { in: { text: "Server: nginx/1.25", fields: { server: "Server:\\s*(.+)" } }, out: { server: "nginx/1.25" } },
	handler: (input) => {
		const text = input.text !== undefined ? input.text : input.value;
		const map = input.fields || input.map;

		if (text === undefined || text === null || !map || typeof map !== "object") {
			return Promise.resolve({});
		}

		return Promise.resolve(extractMap(String(text), map));
	}
};
