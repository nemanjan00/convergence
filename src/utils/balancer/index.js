// Weighted-random pool. The rotation primitive: push candidates with a weight,
// draw one with probability proportional to its weight. Used for user-agent
// rotation (coverage weight), proxy egress, DNS server choice, etc.
//
// A `seed` may be passed to getRandomCandidate for deterministic selection
// (used in tests and for reproducible sampling).

module.exports = () => {
	let candidates = [];
	let weights = [];

	const pool = {
		_weights: [],
		_weightMap: [],
		_max: 0,

		// Recompute the cumulative weight map after any push/delete.
		calculateWeights: () => {
			const min = Math.min(...weights);
			const weightsMap = weights.map((size) => {
				return size / min;
			});

			pool._weights = weightsMap;

			let pointer = 0;
			const weightMap = [];

			weightsMap.forEach((weight) => {
				pointer += weight;
				weightMap.push(pointer);
			});

			pool._weightMap = weightMap;
			pool._max = pointer;
		},

		push: (candidate, weight) => {
			candidates.push(candidate);
			weights.push(weight || 1);

			pool.calculateWeights();
		},

		delete: (candidate) => {
			const index = candidates.indexOf(candidate);

			if (index === -1) {
				return;
			}

			candidates = candidates.slice(0, index).concat(candidates.slice(index + 1));
			weights = weights.slice(0, index).concat(weights.slice(index + 1));

			pool.calculateWeights();
		},

		getRandomCandidate: (seed) => {
			if (candidates.length === 0) {
				return undefined;
			}

			const pointer = (seed === undefined) ? (Math.random() * pool._max) : (seed % pool._max);
			const matches = candidates.filter((_candidate, key) => {
				return pointer < pool._weightMap[key];
			});

			return matches[0];
		},

		getAllCandidates: () => {
			return candidates;
		}
	};

	return pool;
};
