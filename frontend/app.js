// convergence frontend (qrp) — two surfaces over one flow result:
//   - Explorer: entity tables with per-field provenance + a query box + lineage
//   - Builder:  the flow as a typed graph of source -> blocks -> entities
//
// ESM by nature (qrp is ESM). `render(root, data)` has no top-level side effects
// so it runs both in the browser (frontend/entry.js) and under happy-dom in Node
// (frontend/__tests__), which is how the UI is verified without a browser.
//
// data = { flow, yaml, entities: { type: [ {type,key,version,fields:{name:{value,block,at}}} ] }, edges: [...] }

import { state, el, list, when } from "@nemanjan00/qrp";

// Distinct field names across a type's entities, in first-seen order.
const columnsFor = (rows) => {
	const seen = [];

	rows.forEach((row) => {
		Object.keys(row.fields).forEach((name) => {
			if (seen.indexOf(name) === -1) {
				seen.push(name);
			}
		});
	});

	return seen;
};

const matchesQuery = (row, query) => {
	if (!query) {
		return true;
	}

	return JSON.stringify(row.fields).toLowerCase().indexOf(query.toLowerCase()) !== -1;
};

const cell = (field) => {
	if (!field) {
		return el("td", { class: "muted" }, "—");
	}

	return el("td", {},
		el("div", { class: "val" }, String(JSON.stringify(field.value)).replace(/^"|"$/g, "")),
		el("span", { class: "prov" }, field.block)
	);
};

// --- Explorer -------------------------------------------------------------

const explorer = (data, ui) => {
	const types = Object.keys(data.entities);

	const typeTabs = el("div", { class: "chips" }, types.map((type) => {
		return el("button", {
			class: () => (ui.type === type ? "chip active" : "chip"),
			onclick: () => { ui.type = type; }
		}, type + " (" + data.entities[type].length + ")");
	}));

	const search = el("input", {
		class: "search",
		type: "search",
		placeholder: "filter rows…",
		oninput: (e) => { ui.query = e.target.value; }
	});

	const tableWrap = el("div", { class: "scroll" },
		el("table", {},
			el("thead", {}, () => {
				const rows = data.entities[ui.type] || [];
				const cols = columnsFor(rows);

				return el("tr", {}, [el("th", {}, "key")].concat(cols.map((c) => {
					return el("th", {}, c);
				})));
			}),
			el("tbody", {}, list(
				() => {
					const rows = data.entities[ui.type] || [];
					return rows.filter((r) => matchesQuery(r, ui.query));
				},
				(row) => ui.type + "|" + row.key,
				(row) => {
					const cols = columnsFor(data.entities[ui.type] || []);

					return el("tr", {
						class: () => (ui.selected === row.key ? "row sel" : "row"),
						onclick: () => { ui.selected = row.key; }
					}, [el("td", { class: "key" }, row.key)].concat(cols.map((c) => {
						return cell(row.fields[c]);
					})));
				}
			))
		)
	);

	const lineage = el("div", { class: "lineage" }, () => {
		const related = data.edges.filter((edge) => {
			return edge.from.key === ui.selected || edge.to.key === ui.selected;
		});

		if (!ui.selected) {
			return el("p", { class: "muted" }, "select a row to see its lineage");
		}

		if (related.length === 0) {
			return el("p", { class: "muted" }, "no edges for " + ui.selected);
		}

		return el("ul", {}, related.map((edge) => {
			return el("li", {},
				el("code", {}, edge.from.type + " " + edge.from.key),
				el("span", { class: "rel" }, " —" + edge.rel + "→ "),
				el("code", {}, edge.to.type + " " + edge.to.key)
			);
		}));
	});

	return el("div", { class: "panel" }, typeTabs, search, tableWrap,
		el("h3", {}, "lineage"), lineage);
};

// --- Builder --------------------------------------------------------------

const badge = (label, kind) => {
	return el("span", { class: "badge " + (kind || "") }, label);
};

const builder = (data, ui) => {
	const spec = data.spec;

	const sourceCards = (spec.sources || []).map((source) => {
		return el("div", { class: "node source" },
			el("div", { class: "node-h" }, source.id),
			el("div", { class: "node-b" }, source.block),
			el("div", {}, "emits ", badge(source.emits, "out"))
		);
	});

	const blockCards = (spec.blocks || []).map((block) => {
		const derives = block.for_each !== block.merge_into;

		return el("div", {
			class: () => (ui.block === block.id ? "node block sel" : "node block"),
			onclick: () => { ui.block = block.id; }
		},
		el("div", { class: "node-h" }, block.id),
		el("div", { class: "node-b" }, block.uses),
		el("div", {},
			badge(block.for_each, "in"),
			el("span", { class: "arrow" }, derives ? " ⇒ " : " → "),
			badge(block.merge_into, "out")
		),
		block.relation ? el("div", { class: "muted" }, "rel: " + block.relation) : ""
		);
	});

	const entityCards = Object.keys(spec.entities || {}).map((type) => {
		return el("div", { class: "node entity" },
			el("div", { class: "node-h" }, type),
			el("div", { class: "muted" }, "key: " + (spec.entities[type].key || []).join(", "))
		);
	});

	const graph = el("div", { class: "graph" },
		el("div", { class: "col" }, el("h4", {}, "sources"), sourceCards),
		el("div", { class: "col" }, el("h4", {}, "blocks"), blockCards),
		el("div", { class: "col" }, el("h4", {}, "entities"), entityCards)
	);

	const inspector = el("div", { class: "inspector" }, () => {
		const block = (spec.blocks || []).find((b) => b.id === ui.block);

		if (!block) {
			return el("p", { class: "muted" }, "select a block to inspect");
		}

		return el("pre", {}, JSON.stringify(block, null, 2));
	});

	return el("div", { class: "panel" }, graph,
		el("h3", {}, "inspector"), inspector,
		el("h3", {}, "flow yaml"),
		el("pre", { class: "yaml scroll" }, data.yaml || ""));
};

// --- Shell ----------------------------------------------------------------

export const render = (root, data) => {
	const ui = state({
		view: "explorer",
		type: Object.keys(data.entities)[0],
		query: "",
		selected: null,
		block: null
	});

	const tabs = el("div", { class: "tabs" },
		el("button", {
			class: () => (ui.view === "explorer" ? "tab active" : "tab"),
			onclick: () => { ui.view = "explorer"; }
		}, "Explorer"),
		el("button", {
			class: () => (ui.view === "builder" ? "tab active" : "tab"),
			onclick: () => { ui.view = "builder"; }
		}, "Flow builder")
	);

	const body = el("div", {}, when(() => ui.view,
		(view) => (view === "explorer" ? explorer(data, ui) : builder(data, ui))));

	const app = el("div", { class: "app" },
		el("header", {},
			el("h1", {}, "convergence"),
			el("span", { class: "flow" }, data.flow)),
		tabs,
		body);

	root.appendChild(app);

	return app;
};
