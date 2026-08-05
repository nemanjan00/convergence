// Used by babel-jest to transform tests and the few ESM-only dependencies
// (uuid v14, sift) into CommonJS for the Jest runtime. Application code stays
// CommonJS and runs on Node directly without this.
module.exports = {
	presets: [
		["@babel/preset-env", { targets: { node: "current" } }]
	]
};
