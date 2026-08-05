// Playbook registry — manage MANY flows with a lifecycle, the n8n "workflows"
// analog. A playbook is a named, versioned flow YAML in one of three states:
//   draft  — being authored; never runs. May be invalid/incomplete.
//   active — the monitor/scheduler runs it (on its `schedule`); accumulates.
//   paused — kept with its state/history, but not scheduled.
//
// Validity is tracked (via the loader) but a draft is allowed to be invalid;
// activation requires a valid playbook. In-memory REFERENCE implementation,
// Mongo-persistable (see services/persistence — a `playbooks` collection) so
// the set survives restarts, mirroring the store/journal.

const uuid = require("uuid").v4;
const loader = require("../../loader");

const STATES = ["draft", "active", "paused"];

const BOOKS = {};

// Compute {valid, errors} for a YAML string without throwing.
const validityOf = (yamlString) => {
	try {
		const spec = loader.parse(yamlString);
		const errors = loader.validate(spec);

		return { valid: errors.length === 0, errors: errors };
	} catch (error) {
		return { valid: false, errors: [error.message] };
	}
};

const now = () => {
	return new Date().toISOString();
};

const playbooks = {
	STATES: STATES,

	/**
	 * Create a playbook (starts in `draft`).
	 * @param {object} spec
	 * @param {string} spec.name
	 * @param {string} spec.yaml - flow YAML (may be invalid while drafting)
	 * @param {string} [spec.schedule] - cron for the monitor when active
	 * @returns {object} the stored playbook
	 */
	create: (spec) => {
		const options = spec || {};
		const id = options.id || uuid();
		const validity = validityOf(options.yaml || "");
		const at = now();

		const book = {
			id: id,
			name: options.name || "untitled",
			yaml: options.yaml || "",
			schedule: options.schedule || null,
			state: "draft",
			valid: validity.valid,
			errors: validity.errors,
			created_at: at,
			updated_at: at,
			last_run_at: null,
			last_run: null
		};

		BOOKS[id] = book;

		return book;
	},

	get: (id) => {
		return BOOKS[id] || null;
	},

	all: () => {
		return Object.keys(BOOKS).map((id) => { return BOOKS[id]; });
	},

	active: () => {
		return playbooks.all().filter((book) => { return book.state === "active"; });
	},

	/**
	 * Patch name / yaml / schedule. Re-validates when yaml changes.
	 * @returns {object|null} the updated playbook, or null if unknown
	 */
	update: (id, patch) => {
		const book = BOOKS[id];

		if (!book) {
			return null;
		}

		const changes = patch || {};

		if (changes.name !== undefined) { book.name = changes.name; }
		if (changes.schedule !== undefined) { book.schedule = changes.schedule; }

		if (changes.yaml !== undefined) {
			book.yaml = changes.yaml;
			const validity = validityOf(changes.yaml);
			book.valid = validity.valid;
			book.errors = validity.errors;
		}

		book.updated_at = now();

		return book;
	},

	/**
	 * Transition a playbook's state. Activating an invalid playbook is refused
	 * (nothing broken ever gets scheduled).
	 * @param {string} id
	 * @param {"draft"|"active"|"paused"} state
	 * @returns {object} the playbook
	 * @throws if the id is unknown, the state is invalid, or activating an invalid book
	 */
	setState: (id, state) => {
		const book = BOOKS[id];

		if (!book) {
			throw new Error("unknown playbook: " + id);
		}

		if (STATES.indexOf(state) === -1) {
			throw new Error("invalid state: " + state);
		}

		if (state === "active" && !book.valid) {
			throw new Error("cannot activate an invalid playbook: " + book.errors.join("; "));
		}

		book.state = state;
		book.updated_at = now();

		return book;
	},

	// Record the outcome of a run (called by the scheduler/engine wiring).
	recordRun: (id, stats) => {
		const book = BOOKS[id];

		if (!book) {
			return null;
		}

		book.last_run_at = now();
		book.last_run = stats || null;

		return book;
	},

	remove: (id) => {
		const existed = Boolean(BOOKS[id]);
		delete BOOKS[id];

		return existed;
	},

	/**
	 * Export a playbook as a PORTABLE artifact — just what's needed to recreate
	 * it elsewhere (name, schedule, flow YAML), dropping the instance id, state,
	 * and run history. Shareable/diffable/committable.
	 * @returns {object|null} { convergencePlaybook: 1, name, schedule, yaml }
	 */
	export: (id) => {
		const book = BOOKS[id];

		if (!book) {
			return null;
		}

		return {
			convergencePlaybook: 1,
			name: book.name,
			schedule: book.schedule,
			yaml: book.yaml
		};
	},

	/**
	 * Import a portable artifact (from export()) OR a bare flow YAML string, as a
	 * new draft. The name comes from the payload, else the flow's metadata.name.
	 * @param {object|string} payload
	 * @returns {object} the created playbook
	 */
	import: (payload) => {
		if (typeof payload === "string") {
			return playbooks.create({ name: playbooks._nameOf(payload), yaml: payload });
		}

		const data = payload || {};

		return playbooks.create({
			name: data.name || playbooks._nameOf(data.yaml || ""),
			schedule: data.schedule || null,
			yaml: data.yaml || ""
		});
	},

	// Best-effort flow name from YAML (metadata.name), for import defaults.
	_nameOf: (yamlString) => {
		try {
			const spec = loader.parse(yamlString);

			return (spec && spec.metadata && spec.metadata.name) || "imported";
		} catch {
			return "imported";
		}
	},

	// Load persisted playbooks (hydrate before serving).
	hydrate: (books) => {
		(books || []).forEach((book) => { BOOKS[book.id] = book; });

		return playbooks;
	},

	_reset: () => {
		Object.keys(BOOKS).forEach((id) => { delete BOOKS[id]; });

		return playbooks;
	}
};

module.exports = playbooks;
