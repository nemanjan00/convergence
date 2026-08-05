// Block: log — a debug passthrough. It records whatever you template into it and
// changes nothing, so you can drop it anywhere in a flow to inspect the data
// flowing through. The value shows up in the Executions panel (click the run to
// see its input) and on the server console. Convergence-safe: returns no fields,
// so it never changes entity state or re-triggers itself.
//
//   inputs:
//     any: "{{ host }}"      # snapshot the whole entity, or specific fields

module.exports = {
	uses: "log",
	rate: {},
	example: { in: { anything: "{{ host }}" }, out: {} },
	handler: (input) => {
		try {
			console.log("[log] " + JSON.stringify(input));
		} catch {
			console.log("[log]", input);
		}

		// No fields — the value lives in the execution journal (Executions panel).
		return Promise.resolve({});
	}
};
