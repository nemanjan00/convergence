// Block: cli — run a command-line tool and capture its output as fields. This
// image ships a deep recon/forensics toolbox (dig, whois, nmap, sslscan,
// tshark, exiftool, yara, …); the cli block lets a flow reach any of them
// without a bespoke block, the shell-tool escape hatch that mirrors the `js`
// script escape hatch. Pairs with `map`/`js` to parse stdout into typed fields.
//
//   inputs:
//     command: "dig"                      # executable (looked up on PATH)
//     args:    ["+short", "TXT", "{{ host.name }}"]
//     as:      "txt_raw"                  # field for stdout (default "stdout")
//
// SECURITY: NOT a sandbox. It executes real commands with this process's
// privileges; flows are operator/AI-authored and trusted within a deployment.
// argv is passed to execFile (no shell) so inputs aren't re-parsed by a shell —
// but the command itself is whatever the flow says. Do not expose to untrusted
// flow authors. Tolerant: a non-zero exit or spawn error still resolves (with
// exit_code / stderr) rather than breaking the fixpoint.

const execFile = require("child_process").execFile;

const TIMEOUT_MS = 10000;
const MAX_BUFFER = 1024 * 1024;

module.exports = {
	uses: "cli",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const command = input.command;
		const args = Array.isArray(input.args) ? input.args.map(String) : [];

		if (!command) {
			return Promise.resolve({});
		}

		return new Promise((resolve) => {
			execFile(command, args, {
				timeout: Number(input.timeout) || TIMEOUT_MS,
				maxBuffer: MAX_BUFFER
			}, (error, stdout, stderr) => {
				const key = input.as || "stdout";
				const fields = {};

				fields[key] = String(stdout || "").trim();

				if (stderr && String(stderr).trim()) {
					fields.stderr = String(stderr).trim();
				}

				// execFile passes a non-zero exit / signal / timeout as `error`.
				fields.exit_code = error && typeof error.code === "number" ? error.code : 0;

				resolve(fields);
			});
		});
	}
};
