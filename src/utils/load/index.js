// Lazy loader for ESM-only packages from CommonJS code. Many recon libraries
// (e.g. node-rdap-*, various fingerprinters) ship as pure ESM; this defers the
// dynamic `import()` and exposes the chosen export as an ordinary callable, so
// a block written in CommonJS can use it without a build step.
//
// Usage:
//   const whois = load("node-rdap-lacnic", "ip");  // -> (...args) => Promise
//   whois(ip).then(...)

const load = (name, exportName) => {
	// Import lazily on first call (and only once), so requiring a block that
	// depends on an uninstalled ESM package does not throw at load time — it
	// only fails if actually invoked.
	let modulePromise;

	return (...args) => {
		if (!modulePromise) {
			modulePromise = import(name);
		}

		return modulePromise.then((imported) => {
			const target = exportName ? imported[exportName] : imported;

			return target(...args);
		});
	};
};

module.exports = load;
