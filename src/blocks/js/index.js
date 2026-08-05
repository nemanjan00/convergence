// Script block: js — run a snippet of JavaScript as a transform. The
// snippet gets the stdlib helpers (ip, subnet, geo, balancer) as
// globals plus `input` (its resolved inputs, minus `code`), and returns the
// fields to merge. This is the escape hatch for logic that isn't worth a
// dedicated block — the GNU-Radio custom block / n8n Function-node equivalent.
//
//   inputs:
//     code: "return { net: ip(input.ip).mask(24) + '/24' };"
//     ip:   "{{ host.ip }}"
//
// SECURITY: this is NOT a sandbox against hostile code. vm.runInNewContext gives
// a fresh global and a timeout, but a determined script can still escape. Flows
// are operator/AI-authored and trusted within a deployment. TODO: run untrusted
// snippets under isolated-vm (real isolation) before exposing this to
// third-party flow authors.

const vm = require("vm");
const stdlib = require("../../stdlib");

const TIMEOUT_MS = 1000;

module.exports = {
	uses: "js",
	rate: {},
	handler: (input) => {
		const code = input.code;
		const data = Object.assign({}, input);
		delete data.code;

		// Tolerant like every other block: a `code` template that resolves empty
		// yields no fields rather than rejecting (a rejection would unwind the
		// engine sweep and abort the whole run).
		if (!code) {
			return Promise.resolve({});
		}

		// stdlib helpers as globals + the resolved inputs as `input`.
		const sandbox = Object.assign({}, stdlib, { input: data });
		const script = "(function(){\n" + code + "\n})()";

		return Promise.resolve()
			.then(() => {
				const result = vm.runInNewContext(script, sandbox, { timeout: TIMEOUT_MS });

				if (!result || typeof result !== "object") {
					return {};
				}

				return result;
			});
	}
};
