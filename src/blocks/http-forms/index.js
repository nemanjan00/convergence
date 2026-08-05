// Block: http.forms — enumerate the HTML forms on a page: their action, method,
// and input field names, with login/upload/search forms flagged. This is the
// interactive attack surface (auth endpoints, file uploads, search — the places
// worth testing). A cross-origin form action also points at another host.
// Via services/http. Tolerant: no forms / failure => {}.

const http = require("../../services/http");

const attr = (tag, name) => {
	const match = tag.match(new RegExp(name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));

	return match ? match[1] : undefined;
};

const classify = (form) => {
	const names = form.inputs.join(" ").toLowerCase();

	if (form.has_file) { return "upload"; }
	if (/pass(word)?/.test(names)) { return "login"; }
	if (/search|q\b|query/.test(names)) { return "search"; }

	return "form";
};

module.exports = {
	uses: "http.forms",
	rate: { maxConcurrent: 8 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return http.get(url).then((response) => {
			const body = String(response.body || "");
			const blocks = body.match(/<form\b[\s\S]*?<\/form>/gi) || [];

			const forms = blocks.map((block) => {
				const open = (block.match(/<form\b[^>]*>/i) || ["<form>"])[0];
				const inputs = (block.match(/<input\b[^>]*>/gi) || [])
					.map((tag) => { return attr(tag, "name"); })
					.filter(Boolean);

				const form = {
					action: attr(open, "action") || "",
					method: (attr(open, "method") || "get").toLowerCase(),
					inputs: inputs,
					has_file: /type\s*=\s*["']file["']/i.test(block)
				};

				form.kind = classify(form);

				return form;
			});

			if (forms.length === 0) {
				return {};
			}

			return {
				forms: forms,
				has_login: forms.some((form) => { return form.kind === "login"; })
			};
		}).catch(() => {
			return {};
		});
	}
};
