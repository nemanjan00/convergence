// Block: decode — decode an encoded value (base64 / hex / url / rot13). Recon &
// forensics constantly surface encoded blobs: a base64 SPF/verification token, a
// hex-encoded IOC, a percent-encoded redirect. Pure, no network.
//
//   inputs:
//     value:    "aHR0cHM6Ly9ldmlsLmNvbQ=="
//     encoding: "base64" | "hex" | "url" | "rot13" | "auto"   (default "auto")
//     as:       "decoded"                                       (field name)
//
// "auto" guesses: %xx => url, all-hex => hex, else base64. Tolerant: undecodable
// => {}.

const looksHex = (value) => { return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0; };
const looksBase64 = (value) => { return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0; };

const rot13 = (value) => {
	return value.replace(/[a-zA-Z]/g, (char) => {
		const base = char <= "Z" ? 65 : 97;

		return String.fromCharCode((char.charCodeAt(0) - base + 13) % 26 + base);
	});
};

const decoders = {
	base64: (value) => { return Buffer.from(value, "base64").toString("utf8"); },
	hex: (value) => { return Buffer.from(value, "hex").toString("utf8"); },
	url: (value) => { return decodeURIComponent(value); },
	rot13: rot13
};

const pickEncoding = (value) => {
	if (/%[0-9a-fA-F]{2}/.test(value)) { return "url"; }
	if (looksHex(value)) { return "hex"; }
	if (looksBase64(value)) { return "base64"; }

	return null;
};

module.exports = {
	uses: "decode",
	rate: {},
	handler: (input) => {
		const value = input.value;

		if (value === undefined || value === null || value === "") {
			return Promise.resolve({});
		}

		const text = String(value);
		const encoding = (input.encoding && input.encoding !== "auto") ? input.encoding : pickEncoding(text);

		if (!encoding || !decoders[encoding]) {
			return Promise.resolve({});
		}

		try {
			const decoded = decoders[encoding](text);

			if (!decoded) {
				return Promise.resolve({});
			}

			const out = {};
			out[input.as || "decoded"] = decoded;
			out.decoded_as = encoding;

			return Promise.resolve(out);
		} catch {
			return Promise.resolve({});
		}
	}
};
