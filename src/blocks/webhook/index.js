// Block: webhook — the OUTBOUND half of the webhook pair. POSTs the current
// entity (or a chosen payload) as JSON to an external URL whenever the entity it
// watches changes. This is the push side of egress: notify a SIEM/Slack/n8n the
// moment convergence discovers something ("host X just opened port 445").
//
// Convergence-safe by design: it returns NO fields, so firing the webhook does
// not change entity state and therefore cannot re-trigger itself — it runs once
// per real change to its inputs. `url` is required; `payload` defaults to the
// input minus control keys. Tolerant: a failed POST never breaks the fixpoint.

const CONTROL = ["url", "payload", "headers"];

const TIMEOUT_MS = 6000;

const payloadOf = (input) => {
	if (input.payload !== undefined) {
		return input.payload;
	}

	const data = {};

	Object.keys(input).forEach((key) => {
		if (CONTROL.indexOf(key) === -1) {
			data[key] = input[key];
		}
	});

	return data;
};

module.exports = {
	uses: "webhook",
	rate: { maxConcurrent: 5 },
	handler: (input) => {
		const url = input.url;

		if (!url) {
			return Promise.resolve({});
		}

		return fetch(url, {
			method: "POST",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: Object.assign({ "content-type": "application/json" }, input.headers || {}),
			body: JSON.stringify(payloadOf(input))
		}).then(() => {
			// Deliberately no fields — a side-effect sink, not an enricher.
			return {};
		}).catch(() => {
			return {};
		});
	}
};
