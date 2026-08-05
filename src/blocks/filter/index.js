// Block: filter — segment/route/tag the entity stream with Mongo-style (sift)
// predicates. sift is the SAME query dialect used by block `when:` guards, the
// explorer, and (at scale) Mongo itself, so one predicate reads the same
// everywhere. This is the "multiple ways to filter the stream" primitive.
//
// It does not delete entities (nothing is destructive in a convergence store) —
// it CLASSIFIES: matching entities get fields you can then `when:` on downstream,
// which is how you branch a flow ("only dir-bust hosts with 443 open").
//
// Four shapes:
//   1. from: "<array field>" (+ where, as)  → SELECT the elements of an array
//      field that match `where`, e.g. keep only the TXT records that are SPF:
//        from: "txt", where: { value: { $regex: "^v=spf1" } }, as: "spf_records"
//      Each element is tested as a doc where `value` is the whole element (and,
//      for object elements, its own keys are lifted to the top too), so you can
//      match scalars ({ value: { $regex } }) or fields ({ port: 443 }). Emits
//      the matched elements under `as` (default "<from>_matched"); [] => {}.
//   2. rules: [ { when: <sift>, set: {..}, label: "web" }, … ]  → first match wins;
//      merges that rule's `set` plus `{ class: label }`. A switch/router.
//   3. where: <sift> (+ set / as / tag)  → if the subject matches, merge `set`
//      (or `{ [as]: true }`, or push `tag` into `tags`, default `{ match: true }`).
//   4. none of the above  → no-op ({}), so an unconfigured filter is inert.
//
// The subject tested (shapes 2-3) is `input.subject` (pass the whole entity,
// e.g. subject: "{{ host }}") or, if absent, the input minus the filter's keys.

const sift = require("sift").default;

const CONTROL = ["where", "rules", "set", "as", "tag", "subject", "from"];

const subjectOf = (input) => {
	if (input.subject && typeof input.subject === "object") {
		return input.subject;
	}

	const data = {};

	Object.keys(input).forEach((key) => {
		if (CONTROL.indexOf(key) === -1) {
			data[key] = input[key];
		}
	});

	return data;
};

// Tolerant match: a malformed query never throws into the engine, it just
// fails closed (no match).
const matches = (query, subject) => {
	if (!query) {
		return true;
	}

	try {
		return sift(query)(subject);
	} catch {
		return false;
	}
};

module.exports = {
	uses: "filter",
	rate: {},
	handler: (input) => {
		const subject = subjectOf(input);

		// Shape 1: select matching elements of an array field.
		if (input.from) {
			const array = subject[input.from];

			if (!Array.isArray(array)) {
				return Promise.resolve({});
			}

			const matched = array.filter((element) => {
				const doc = (element && typeof element === "object")
					? Object.assign({ value: element }, element)
					: { value: element };

				return matches(input.where, doc);
			});

			if (matched.length === 0) {
				return Promise.resolve({});
			}

			const out = {};
			out[input.as || (input.from + "_matched")] = matched;

			return Promise.resolve(out);
		}

		if (Array.isArray(input.rules)) {
			const hit = input.rules.find((rule) => { return matches(rule.when, subject); });

			if (!hit) {
				return Promise.resolve({});
			}

			const fields = Object.assign({}, hit.set || {});

			if (hit.label) {
				fields.class = hit.label;
			}

			return Promise.resolve(fields);
		}

		// No predicate at all → inert.
		if (!input.where) {
			return Promise.resolve({});
		}

		if (!matches(input.where, subject)) {
			return Promise.resolve({});
		}

		const fields = Object.assign({}, input.set || {});

		if (input.as) {
			fields[input.as] = true;
		}

		if (input.tag) {
			fields.tags = [].concat(input.tag);
		}

		if (Object.keys(fields).length === 0) {
			fields.match = true;
		}

		return Promise.resolve(fields);
	}
};
