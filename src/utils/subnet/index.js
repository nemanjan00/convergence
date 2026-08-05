// Subnet calculator (VLSM). Given required host counts, a base network, and a
// mask, lay out non-overlapping subnets largest-first and return each with its
// mask, network address, and first usable IP.
//
// Usage: subnet([50, 20, 10], "10.0.0.0", 24)

const ipLib = require("ip");

module.exports = (subnetComputers, network) => {
	const subneter = {
		main: (requiredCounts, baseNetwork) => {
			const binaryNetwork = ipLib.toLong(baseNetwork);
			const used = subneter.fillArray(32, 0);

			// Largest requirement first so big blocks are placed before small.
			const ordered = requiredCounts.slice().sort((a, b) => {
				return b - a;
			});

			return ordered.map(subneter.countToMask).map((result) => {
				let addition = 0;

				used.forEach((bit) => {
					addition = addition << 1;
					addition += bit;
				});

				const placed = Object.assign({}, result, {
					network: ipLib.fromLong(binaryNetwork + addition),
					firstIP: ipLib.fromLong(binaryNetwork + addition + 1)
				});

				used[result.mask - 1]++;

				return placed;
			});
		},

		maskToBinary: (maskSize) => {
			let remaining = maskSize;
			let binaryMask = 0;

			for (let i = 0; i < 32; i++) {
				binaryMask = binaryMask << 1;

				if (remaining > 0) {
					binaryMask++;
				}

				remaining--;
			}

			return binaryMask;
		},

		// Smallest mask that fits `count` hosts.
		countToMask: (count) => {
			let counter = 0;
			let i = 0;

			do {
				i++;
				counter = counter << 1;
				counter++;
			} while (counter - 1 < count);

			return {
				computerCount: count,
				mask: 32 - i,
				binaryMask: subneter.maskToBinary(32 - i)
			};
		},

		fillArray: (size, content) => {
			return Array(size).fill(content);
		}
	};

	return subneter.main(subnetComputers, network);
};
