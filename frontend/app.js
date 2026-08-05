// convergence frontend (qrp) — two surfaces over one flow result:
//   - Explorer: entity tables with per-field provenance + a query box + lineage
//   - Builder:  an n8n-style node canvas — source/blocks/entities wired by the
//     real dataflow, draggable, with an inspector + YAML
//
// ESM by nature (qrp is ESM). `render(root, data)` has no top-level side effects
// so it runs both in the browser (frontend/entry.js) and under happy-dom in Node
// (frontend/__tests__), which is how the UI is verified without a browser.

import { state, el, list, when } from "@nemanjan00/qrp";
import { dump as dumpYamlLib } from "js-yaml";

const dumpYaml = (spec) => {
	// Serialize a plain clone so js-yaml never sees the reactive proxy.
	return dumpYamlLib(JSON.parse(JSON.stringify(spec)));
};

const NODE_W = 184;
const NODE_H = 62;
const COL = 260;
const ROW = 104;

// --- Explorer -------------------------------------------------------------

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
				const cols = columnsFor(data.entities[ui.type] || []);

				return el("tr", {}, [el("th", {}, "key")].concat(cols.map((c) => {
					return el("th", {}, c);
				})));
			}),
			el("tbody", {}, list(
				() => {
					return (data.entities[ui.type] || []).filter((r) => matchesQuery(r, ui.query));
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
		if (!ui.selected) {
			return el("p", { class: "muted" }, "select a row to see its lineage");
		}

		const related = data.edges.filter((edge) => {
			return edge.from.key === ui.selected || edge.to.key === ui.selected;
		});

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

// --- Builder graph model --------------------------------------------------

// Build nodes + edges + a layered left-to-right layout from the flow spec.
const computeGraph = (spec) => {
	const sources = spec.sources || [];
	const blocks = spec.blocks || [];
	const entityTypes = Object.keys(spec.entities || {});

	const nodes = [];
	const push = (id, kind, title, sub, meta) => {
		nodes.push({ id: id, kind: kind, title: title, sub: sub, meta: meta || {} });
	};

	sources.forEach((s) => { push("S:" + s.id, "source", s.id, s.block, { emits: s.emits }); });
	entityTypes.forEach((t) => { push("E:" + t, "entity", t, "key: " + (spec.entities[t].key || []).join(", "), {}); });
	blocks.forEach((b) => { push("B:" + b.id, "block", b.id, b.uses, { block: b }); });

	const edges = [];
	sources.forEach((s) => { edges.push({ from: "S:" + s.id, to: "E:" + s.emits }); });
	blocks.forEach((b) => {
		edges.push({ from: "E:" + b.for_each, to: "B:" + b.id });
		edges.push({ from: "B:" + b.id, to: "E:" + b.merge_into, rel: b.relation });
	});

	// Layer depth: source(0) -> emitted entity(1) -> block -> merge_into entity.
	const depth = {};
	sources.forEach((s) => { depth["S:" + s.id] = 0; });
	sources.forEach((s) => { if (depth["E:" + s.emits] === undefined) { depth["E:" + s.emits] = 1; } });

	for (let i = 0; i < blocks.length + 2; i++) {
		blocks.forEach((b) => {
			const fe = "E:" + b.for_each;

			if (depth[fe] !== undefined) {
				const bd = "B:" + b.id;

				if (depth[bd] === undefined) { depth[bd] = depth[fe] + 1; }

				const me = "E:" + b.merge_into;

				if (depth[me] === undefined) { depth[me] = depth[bd] + 1; }
			}
		});
	}

	nodes.forEach((n) => { if (depth[n.id] === undefined) { depth[n.id] = 0; } });

	const byDepth = {};
	nodes.forEach((n) => { (byDepth[depth[n.id]] = byDepth[depth[n.id]] || []).push(n); });

	const pos = {};
	Object.keys(byDepth).forEach((d) => {
		byDepth[d].forEach((n, i) => {
			pos[n.id] = { x: 40 + Number(d) * COL, y: 34 + i * ROW };
		});
	});

	return { nodes: nodes, edges: edges, pos: pos };
};

const wirePath = (a, b) => {
	const sx = a.x + NODE_W;
	const sy = a.y + NODE_H / 2;
	const ex = b.x;
	const ey = b.y + NODE_H / 2;
	const dx = Math.max(40, Math.abs(ex - sx) * 0.5);

	return "M " + sx + "," + sy + " C " + (sx + dx) + "," + sy + " " + (ex - dx) + "," + ey + " " + ex + "," + ey;
};

// Edges from the CURRENT (editable) spec. In-place enrichment
// (for_each === merge_into) draws ONE input wire — the write-back is an implicit
// self-loop shown as a badge, not an ugly backward-crossing wire. A real
// derivation (fanout: cert -> host) draws the forward output wire too.
const edgesFromSpec = (spec) => {
	const edges = [];

	(spec.sources || []).forEach((s) => {
		edges.push({ from: "S:" + s.id, to: "E:" + s.emits });
	});

	(spec.blocks || []).forEach((b) => {
		edges.push({ from: "E:" + b.for_each, to: "B:" + b.id, hot: b.id });

		if (b.merge_into !== b.for_each) {
			edges.push({ from: "B:" + b.id, to: "E:" + b.merge_into, rel: b.relation, hot: b.id });
		}
	});

	return edges;
};

const field = (label, control) => {
	return el("div", { class: "field" }, el("label", {}, label), control);
};

const builder = (data, ui) => {
	const graph = ui.graph;

	const stageW = () => { ui.frame; return Math.max.apply(null, graph.nodes.map((n) => ui.pos[n.id].x + NODE_W + 60)); };
	const stageH = () => { ui.frame; return Math.max.apply(null, graph.nodes.map((n) => ui.pos[n.id].y + NODE_H + 60)); };

	const wires = el("svg", { class: "wires", width: stageW, height: stageH },
		el("defs", {},
			el("marker", {
				id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
				markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse"
			}, el("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--wire)" }))
		),
		// Reactive edge layer: recomputed when topology (for_each/merge_into) or
		// positions change.
		() => {
			ui.frame;

			const edges = edgesFromSpec(ui.spec).filter((e) => ui.pos[e.from] && ui.pos[e.to]);

			return el("g", {}, edges.map((edge) => {
				return el("path", {
					class: () => (ui.block === edge.hot ? "wire hot" : "wire"),
					"marker-end": "url(#arrow)",
					d: () => { ui.frame; return wirePath(ui.pos[edge.from], ui.pos[edge.to]); }
				});
			}));
		}
	);

	const nodeEls = graph.nodes.map((node) => {
		const b = node.meta.block;

		return el("div", {
			class: () => "gnode " + node.kind + (node.kind === "block" && ui.block === b.id ? " sel" : ""),
			style: () => { ui.frame; const p = ui.pos[node.id]; return "left:" + p.x + "px;top:" + p.y + "px"; },
			onmousedown: (e) => {
				if (node.kind === "block") { ui.block = b.id; }
				ui.drag = { id: node.id, px: e.clientX, py: e.clientY, ox: ui.pos[node.id].x, oy: ui.pos[node.id].y };
				e.preventDefault();
			}
		},
		el("div", { class: "port in" }),
		el("div", { class: "port out" }),
		el("div", { class: "kind" }, node.kind),
		el("div", { class: "title" }, node.title),
		el("div", { class: "sub" }, node.kind === "block" ? (() => { ui.frame; return b.uses; }) : node.sub),
		el("div", { class: "meta" }, () => {
			ui.frame;
			const m = [];

			if (node.kind === "source") { m.push(el("span", { class: "badge" }, "emits " + node.meta.emits)); }

			if (b) {
				m.push(el("span", { class: "badge in" }, "for " + b.for_each));
				m.push(el("span", { class: "badge out" }, "→ " + b.merge_into));
				if (b.relation) { m.push(el("span", { class: "badge rel" }, b.relation)); }
			}

			return el("span", { class: "row-badges" }, m);
		}));
	});

	const canvas = el("div", { class: "canvas" },
		el("div", { class: "stage", style: () => { ui.frame; return "width:" + stageW() + "px;height:" + stageH() + "px"; } },
			wires, nodeEls));

	// Editable inspector — re-rendered only when the SELECTED block changes (so
	// typing never loses focus). Edits mutate the spec + bump frame; YAML, wires,
	// and badges follow live.
	const jsonField = (label, block, key) => {
		const err = state({ msg: "" });

		return el("div", { class: "field" },
			el("label", {}, label),
			el("textarea", {
				spellcheck: "false",
				oninput: (e) => {
					const text = e.target.value.trim();

					if (text === "") { delete block[key]; err.msg = ""; ui.frame = ui.frame + 1; return; }

					try {
						block[key] = JSON.parse(text);
						err.msg = "";
						ui.frame = ui.frame + 1;
					} catch {
						err.msg = "invalid JSON — not applied";
					}
				}
			}, JSON.stringify(block[key] || {}, null, 2)),
			() => (err.msg ? el("div", { class: "err" }, err.msg) : ""));
	};

	const editor = () => {
		const block = (ui.spec.blocks || []).find((x) => x.id === ui.block);

		if (!block) {
			return el("p", { class: "muted" }, "drag nodes to arrange · click a block to edit it");
		}

		const options = (current) => Object.keys(ui.spec.entities || {}).map((t) => {
			return el("option", { value: t, selected: t === current }, t);
		});

		return el("div", { class: "editor" },
			field("uses", el("input", { class: "in", value: block.uses, oninput: (e) => { block.uses = e.target.value; ui.frame = ui.frame + 1; } })),
			field("for_each", el("select", { class: "in", onchange: (e) => { block.for_each = e.target.value; ui.frame = ui.frame + 1; } }, options(block.for_each))),
			field("merge_into", el("select", { class: "in", onchange: (e) => { block.merge_into = e.target.value; ui.frame = ui.frame + 1; } }, options(block.merge_into))),
			field("relation", el("input", { class: "in", value: block.relation || "", oninput: (e) => { const v = e.target.value.trim(); if (v) { block.relation = v; } else { delete block.relation; } ui.frame = ui.frame + 1; } })),
			jsonField("when (sift query)", block, "when"),
			jsonField("inputs", block, "inputs"),
			jsonField("rate", block, "rate"));
	};

	return el("div", { class: "panel builder" },
		el("div", { class: "hint" }, "source → blocks → entities · in-place enrichment loops on its entity · drag to arrange · click a block to edit"),
		canvas,
		el("div", { class: "side" },
			el("h3", {}, "edit block"),
			el("div", { class: "inspector" }, when(() => ui.block, () => editor())),
			el("h3", {}, "flow yaml (live)"),
			el("pre", { class: "yaml scroll" }, () => { ui.frame; return dumpYaml(ui.spec); })));
};

// --- Shell ----------------------------------------------------------------

export const render = (root, data) => {
	const graph = computeGraph(data.spec || { entities: {}, sources: [], blocks: [] });

	const ui = state({
		view: "explorer",
		type: Object.keys(data.entities)[0],
		query: "",
		selected: null,
		block: null,
		graph: graph,
		pos: graph.pos,
		spec: data.spec,
		frame: 0,
		drag: null
	});

	// Dragging: document-level so the pointer can leave the node mid-drag.
	document.addEventListener("mousemove", (e) => {
		if (!ui.drag) { return; }
		ui.pos[ui.drag.id].x = ui.drag.ox + (e.clientX - ui.drag.px);
		ui.pos[ui.drag.id].y = ui.drag.oy + (e.clientY - ui.drag.py);
		ui.frame = ui.frame + 1;
	});
	document.addEventListener("mouseup", () => { ui.drag = null; });

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
