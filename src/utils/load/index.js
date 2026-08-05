// Lazy loader for ESM-only packages from CommonJS code. Many recon libraries
// (e.g. node-rdap-*, various fingerprinters) ship as pure ESM; this defers the
// dynamic `import()` and exposes the chosen export as an ordinary callable, so
// a block written in CommonJS can use it without a build step.
//
// Usage:
//   const whois = load("node-rdap-lacnic", "ip");  // -> (...args) => Promise
//   whois(ip).then(...)

const load = (name, exportName) => {
	const modulePromise = import(name);

	return (...args) => {
		return modulePromise.then((imported) => {
			const target = exportName ? imported[exportName] : imported;

			return target(...args);
		});
	};
};

module.exports = load;
