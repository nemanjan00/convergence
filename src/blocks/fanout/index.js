// Block: fanout — explode an array into many entities (one per element). The
// engine turns an array return into a fan-out, so this block just maps each
// element of `items` to an entity field-set { [as]: element }. Generic and
// subject-agnostic: a cert's SANs -> one host each, an ASN's prefixes -> one
// network each, etc.
//
//   uses: fanout
//   for_each: cert
//   inputs: { items: "{{ cert.san }}", as: "name" }
//   merge_into: host           # -> one host { name: <san> } per SAN

module.exports = {
	uses: "fanout",
	rate: {},
	handler: (input) => {
		const items = input.items || [];
		const as = input.as || "value";

		return Promise.resolve(items.map((item) => {
			const entity = {};
			entity[as] = item;

			return entity;
		}));
	}
};
