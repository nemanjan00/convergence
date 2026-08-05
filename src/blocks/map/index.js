// Block: map — declaratively transform a JSON object into typed fields. This is
// the "parse a JSON, produce a different type" step: point `pick` at dotted /
// indexed paths inside `from`, and the resulting fields flow into the entity
// (and, when typed with `links`, materialize their own entities). Reuses the
// same path resolver as `{{ }}` templates. Pure, no network.
//
//   uses: map
//   inputs:
//     from: "{{ ip.json }}"
//     pick: { country: "country", org: "org", asn: "as" }

const resolvePath = require("../../utils/template").resolvePath;

module.exports = {
	uses: "map",
	rate: {},
	handler: (input) => {
		const from = input.from || {};
		const pick = input.pick || {};
		const out = {};

		Object.keys(pick).forEach((target) => {
			const value = resolvePath(from, pick[target]);

			if (value !== null && value !== undefined) {
				out[target] = value;
			}
		});

		return Promise.resolve(out);
	}
};
