// Block: fanout — explode an array into many entities (one per element). The
// engine turns an array return into a fan-out (one target entity per element)
// and records a lineage edge parent --relation--> child. This block just shapes
// each element into a child field-set. Generic and subject-agnostic: a cert's
// SANs -> one host each, an ASN's prefixes -> one network each, etc.
// See docs/DATA_MODEL.md.
//
//   uses: fanout
//   for_each: cert
//   inputs:
//     items: "{{ cert.san }}"                        # the array to explode
//     as: name                                       # child identity field <- element
//     carry: { first_seen: "{{ cert.not_before }}" } # optional fields onto each child
//   merge_into: host
//   relation: has_san                                # edge label (read by the engine)

module.exports = {
	uses: "fanout",
	rate: {},
	handler: (input) => {
		const items = input.items || [];
		const as = input.as || "value";
		const carry = input.carry || {};

		return Promise.resolve(items.map((item) => {
			const entity = Object.assign({}, carry);
			entity[as] = item;

			return entity;
		}));
	}
};
