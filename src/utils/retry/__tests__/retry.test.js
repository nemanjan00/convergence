const retry = require("../index");

describe("retry", () => {
	it("resolves after transient failures within the retry budget", () => {
		let calls = 0;
		const flaky = () => {
			calls++;

			if (calls < 3) {
				return Promise.reject(new Error("transient"));
			}

			return Promise.resolve("ok");
		};

		return retry(flaky, 3)().then((value) => {
			expect(value).toBe("ok");
			expect(calls).toBe(3);
		});
	});

	it("rejects with the last error once the budget is exhausted", () => {
		let calls = 0;
		const always = () => {
			calls++;
			return Promise.reject(new Error("nope"));
		};

		return retry(always, 2)().then(
			() => {
				throw new Error("expected rejection");
			},
			(error) => {
				expect(error.message).toBe("nope");
				expect(calls).toBe(3); // initial + 2 retries
			}
		);
	});
});
