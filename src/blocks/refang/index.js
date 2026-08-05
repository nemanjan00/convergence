// Block: refang — normalize a "defanged" indicator back to its real form so the
// rest of the pipeline can act on it. Threat reports deliberately neuter IOCs
// (hxxp://1[.]2[.]3[.]4, evil(dot)com, user[at]evil.com) so they aren't
// clickable; recon needs them live. `mode: "defang"` does the inverse for safe
// display/reporting. Pure, no network.
//
//   inputs:
//     value: "hxxps://bad[.]example[.]com/path"
//     mode:  "refang" (default) | "defang"
//     as:    "refanged"  (field name; default depends on mode)

const refang = (value) => {
	return value
		.replace(/h(xx|XX)p/g, "http")
		.replace(/\[\.\]|\(\.\)|\{\.\}|\s*\(dot\)\s*|\s*\[dot\]\s*/gi, ".")
		.replace(/\[:\]/g, ":")
		.replace(/\[\/\]/g, "/")
		.replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, "@")
		.replace(/\[@\]/g, "@");
};

const defang = (value) => {
	return value
		.replace(/http/gi, "hxxp")
		.replace(/\./g, "[.]")
		.replace(/:/g, "[:]")
		.replace(/@/g, "[at]");
};

module.exports = {
	uses: "refang",
	rate: {},
	handler: (input) => {
		const value = input.value;

		if (value === undefined || value === null || value === "") {
			return Promise.resolve({});
		}

		const mode = input.mode === "defang" ? "defang" : "refang";
		const result = mode === "defang" ? defang(String(value)) : refang(String(value));
		const out = {};

		out[input.as || mode + "ed"] = result;

		return Promise.resolve(out);
	}
};
