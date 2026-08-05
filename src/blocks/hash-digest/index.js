// Block: hash.digest — cryptographic digests (md5/sha1/sha256) of an input
// value. A forensics normalizer: malware reports quote IOCs by hash, and hashing
// a shared string (a favicon body, a TLS cert DER, a filename) lets unrelated
// entities be correlated by a common digest. `algos` selects which to emit
// (default all three). Not in stdlib on purpose — node's crypto isn't
// frontend-shippable. Tolerant: no value => {}.

const crypto = require("crypto");

const ALGOS = ["md5", "sha1", "sha256"];

module.exports = {
	uses: "hash.digest",
	rate: {},
	handler: (input) => {
		const value = input.value;

		if (value === undefined || value === null || value === "") {
			return Promise.resolve({});
		}

		const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
		const wanted = Array.isArray(input.algos) && input.algos.length > 0 ? input.algos : ALGOS;

		const fields = {};

		wanted
			.filter((algo) => { return ALGOS.indexOf(algo) !== -1; })
			.forEach((algo) => {
				fields[algo] = crypto.createHash(algo).update(data).digest("hex");
			});

		return Promise.resolve(fields);
	}
};
