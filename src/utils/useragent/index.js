// Coverage-weighted realistic user-agent picker. Pools real UAs (from
// random-useragent + top-user-agents), keeps only those browserslist recognises
// with meaningful market coverage, and draws one weighted by that coverage — so
// outbound HTTP recon looks like the browsers people actually use.

const browserslist = require("browserslist");
const UAParser = require("ua-parser-js").UAParser || require("ua-parser-js");
const balancer = require("../balancer");
const randomUseragent = require("random-useragent");
const useragents = require("top-user-agents/desktop");

const MIN_POOL_COVERAGE = 0.1;
const MIN_REPORT_COVERAGE = 0.5;

// Normalize UAParser browser names to browserslist family names.
const NAME_MAP = {
	"Mobile Safari": "iOS",
	"Android Browser": "Android",
	"Samsung Browser": "Samsung"
};

const BROWSERS = [
	"Android", "Baidu", "Chrome", "ChromeAndroid", "Safari", "Edge",
	"Explorer", "Firefox", "FirefoxAndroid", "iOS", "Samsung", "IE"
].map((name) => {
	return name.toLowerCase();
});

const useragentManager = {
	_sources: [
		() => {
			const folders = [
				"/Browsers - Windows",
				"/Browsers - Mac",
				"/Browsers - Linux",
				"/Browsers - Unix",
				"/Mobile Devices/OS/Android",
				"/Mobile Devices/OS/iOS"
			];

			return randomUseragent.getAll((useragent) => {
				return folders.indexOf(useragent.folder) !== -1 &&
					useragent.userAgent.indexOf("Mozilla") === 0;
			});
		},
		() => {
			return useragents;
		}
	],

	getUseragents: () => {
		const pooled = useragentManager._sources
			.map((source) => {
				return source();
			})
			.reduce((prev, cur) => {
				return prev.concat(cur);
			}, []);

		const unique = {};

		pooled.forEach((useragent) => {
			unique[useragent] = true;
		});

		return Object.keys(unique).filter((userAgent) => {
			const browserslistFormat = useragentManager.toBrowsersListFormat(userAgent);

			if (!browserslistFormat) {
				return false;
			}

			return browserslist.coverage([browserslistFormat]) > MIN_POOL_COVERAGE;
		});
	},

	getRandomUseragent: () => {
		if (useragentManager.randomizer) {
			return useragentManager.randomizer.getRandomCandidate();
		}

		const randomizer = balancer();
		useragentManager.randomizer = randomizer;

		useragentManager.getUseragents().forEach((useragent) => {
			const coverage = browserslist.coverage([
				useragentManager.toBrowsersListFormat(useragent)
			]);

			randomizer.push(useragent, coverage * 100);
		});

		return randomizer.getRandomCandidate();
	},

	toBrowsersListFormat: (userAgent) => {
		const parsed = new UAParser(userAgent);
		const os = parsed.getOS();
		const browser = parsed.getBrowser();

		if (!browser.name || !browser.version) {
			return false;
		}

		// Firefox on Android is a distinct browserslist family.
		let browserName = browser.name;

		if (os.name === "Android" && browserName === "Firefox") {
			browserName = "FirefoxAndroid";
		}

		browserName = NAME_MAP[browserName] || browserName;

		if (BROWSERS.indexOf(browserName.toLowerCase()) === -1) {
			return false;
		}

		return browserName.toLowerCase() + " " + browser.version.split(".")[0];
	},

	calculateCoverage: () => {
		const userAgents = useragentManager.getUseragents().filter((userAgent) => {
			const browserslistFormat = useragentManager.toBrowsersListFormat(userAgent);

			if (!browserslistFormat) {
				return false;
			}

			return browserslist.coverage([browserslistFormat]) > MIN_REPORT_COVERAGE;
		});

		const agents = {};

		userAgents
			.map((userAgent) => {
				return useragentManager.toBrowsersListFormat(userAgent);
			})
			.forEach((agent) => {
				agents[agent] = true;
			});

		return browserslist.coverage(Object.keys(agents));
	}
};

module.exports = useragentManager;
