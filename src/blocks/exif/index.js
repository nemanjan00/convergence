// Block: exif — pull embedded metadata out of a file (image, PDF, office doc,
// binary) with exiftool, the forensics/doc-OSINT staple. Photos leak GPS
// coordinates, camera make/model and serials; PDFs/office docs leak author,
// the producing software, and create/modify timestamps — all attribution gold.
// `gps`/`author`/`software`/`created` are surfaced as first-class fields (GPS
// typed to link -> a geo/location entity); the full dump is under `exif`.
//
//   inputs:
//     file: "/path/to/evidence.jpg"
//
// Uses the installed exiftool via execFile (no shell). Tolerant: missing tool /
// missing file / no metadata => {}.

const execFile = require("child_process").execFile;

const TIMEOUT_MS = 10000;
const MAX_BUFFER = 4 * 1024 * 1024;

module.exports = {
	uses: "exif",
	rate: { maxConcurrent: 4 },
	handler: (input) => {
		const file = input.file || input.path;

		if (!file) {
			return Promise.resolve({});
		}

		return new Promise((resolve) => {
			execFile("exiftool", ["-json", "-n", String(file)], {
				timeout: TIMEOUT_MS,
				maxBuffer: MAX_BUFFER
			}, (error, stdout) => {
				if (error && !stdout) {
					return resolve({});
				}

				let parsed;

				try {
					parsed = JSON.parse(stdout);
				} catch {
					return resolve({});
				}

				const meta = Array.isArray(parsed) ? parsed[0] : parsed;

				if (!meta || typeof meta !== "object") {
					return resolve({});
				}

				const fields = { exif: meta };

				// Lift the high-signal attribution fields to the top.
				if (meta.GPSLatitude !== undefined && meta.GPSLongitude !== undefined) {
					fields.gps = meta.GPSLatitude + "," + meta.GPSLongitude;
				}

				const author = meta.Author || meta.Creator || meta.Artist;
				const software = meta.Software || meta.CreatorTool || meta.Producer;
				const created = meta.CreateDate || meta.DateTimeOriginal;
				const camera = [meta.Make, meta.Model].filter(Boolean).join(" ");

				if (author) { fields.author = author; }
				if (software) { fields.software = software; }
				if (created) { fields.created = created; }
				if (camera) { fields.camera = camera; }

				resolve(fields);
			});
		});
	}
};
