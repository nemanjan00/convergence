// Block: email.parse — split an email address into local-part and domain. Pure,
// no network. The `domain` field is typed to link -> a domain (or host) entity,
// so an email harvested from a cert / security.txt / WHOIS pivots into its
// domain, which CT/DNS/MX blocks then expand — the email->CT recon pivot.
// Tolerant: no "@" => {}.

module.exports = {
	uses: "email.parse",
	rate: {},
	handler: (input) => {
		const address = String(input.email || "").trim().toLowerCase();
		const at = address.lastIndexOf("@");

		if (at <= 0 || at === address.length - 1) {
			return Promise.resolve({});
		}

		return Promise.resolve({
			local: address.slice(0, at),
			domain: address.slice(at + 1)
		});
	}
};
