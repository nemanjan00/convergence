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
const ROW = 132;

// Discovery-graph node box (matches `.gnode.ent` in style.css). Height is a
// generous estimate: entity labels (long hostnames) wrap to 2-3 lines, so the
// real box is taller than one line — the layout spaces for the tall case so
// wrapped nodes still don't touch.
const GNODE_W = 168;
const GNODE_H = 84;

// Below this viewport width we lay graphs out top-to-bottom (layers stack
// downward) instead of left-to-right, so a phone scrolls vertically through the
// discovery chain instead of overflowing sideways.
const NARROW_PX = 720;

const isNarrow = () => {
	return typeof window !== "undefined" && window.innerWidth > 0 && window.innerWidth < NARROW_PX;
};

// Layered ("Sugiyama-lite") DAG layout — the readable-placement algorithm shared
// by the flow builder and the discovery graph. Instead of dumping every node of
// a kind into one column (which crosses wires and overlaps labels), it:
//   1. ranks each node by its longest path from a root, so a node always sits
//      one layer past whatever discovered it;
//   2. orders nodes within a layer by the barycenter of their neighbours
//      (a few sweeps) to pull connected nodes in line and cut edge crossings;
//   3. centres each layer and spaces nodes by more than a node's own size, so
//      nothing overlaps.
// `vertical` flips the main axis to run downward (phones); otherwise rightward.
// Returns an { id: {x, y} } map.
const layoutLayered = (nodes, edges, opts) => {
	const nodeW = opts.nodeW;
	const nodeH = opts.nodeH;
	const vertical = opts.vertical;
	const gapMain = opts.gapMain;
	const gapCross = opts.gapCross;
	const pad = 34;

	const present = {};
	nodes.forEach((n) => { present[n.id] = true; });

	const links = edges.filter((e) => {
		return present[e.from] && present[e.to] && e.from !== e.to;
	});

	// Neighbour lists, reused for cycle detection, ranking, and barycenters.
	const up = {};
	const down = {};
	nodes.forEach((n) => { up[n.id] = []; down[n.id] = []; });
	links.forEach((e) => {
		down[e.from].push(e.to);
		up[e.to].push(e.from);
	});

	// Break cycles: a DFS marks any edge pointing back to a node still on the
	// stack as a back-edge (host->block->host in-place enrichment, host->ip->host
	// ptr loops). Ranking then runs only over the remaining forward edges, so a
	// loop can't spiral the longest path downward.
	const mark = {}; // 0 unseen, 1 on-stack, 2 done
	const back = {}; // back[from] = { to: true } — edges to skip when ranking
	nodes.forEach((n) => { mark[n.id] = 0; back[n.id] = {}; });

	const dfs = (id) => {
		mark[id] = 1;
		down[id].forEach((to) => {
			if (mark[to] === 1) { back[id][to] = true; }
			else if (mark[to] === 0) { dfs(to); }
		});
		mark[id] = 2;
	};
	nodes.forEach((n) => { if (mark[n.id] === 0) { dfs(n.id); } });

	// Rank = longest path from a root, over forward edges only, in topological
	// (Kahn) order — a single correct pass, no fixpoint iteration.
	const fdown = {};
	const indeg = {};
	nodes.forEach((n) => { fdown[n.id] = []; indeg[n.id] = 0; });
	links.forEach((e) => {
		if (back[e.from][e.to]) { return; }
		fdown[e.from].push(e.to);
		indeg[e.to] = indeg[e.to] + 1;
	});

	const rank = {};
	nodes.forEach((n) => { rank[n.id] = 0; });

	const queue = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);

	while (queue.length > 0) {
		const id = queue.shift();

		fdown[id].forEach((to) => {
			if (rank[to] < rank[id] + 1) { rank[to] = rank[id] + 1; }
			indeg[to] = indeg[to] - 1;
			if (indeg[to] === 0) { queue.push(to); }
		});
	}

	const layers = [];
	nodes.forEach((n) => {
		const r = rank[n.id];
		layers[r] = layers[r] || [];
		layers[r].push(n.id);
	});
	for (let r = 0; r < layers.length; r++) { layers[r] = layers[r] || []; }

	const orderIndex = {};
	layers.forEach((layer) => { layer.forEach((id, i) => { orderIndex[id] = i; }); });

	for (let sweep = 0; sweep < 6; sweep++) {
		const downward = sweep % 2 === 0;

		layers.forEach((layer) => {
			const scored = layer.map((id, i) => {
				const neigh = downward ? up[id] : down[id];
				const bary = neigh.length === 0
					? orderIndex[id]
					: neigh.reduce((sum, nb) => sum + orderIndex[nb], 0) / neigh.length;

				return { id: id, bary: bary, tie: i };
			});

			scored.sort((a, b) => {
				if (a.bary === b.bary) { return a.tie - b.tie; }
				return a.bary - b.bary;
			});

			scored.forEach((s, i) => { layer[i] = s.id; orderIndex[s.id] = i; });
		});
	}

	// Coordinates: main axis walks the layers, cross axis spreads nodes within a
	// layer; each layer is centred against the widest one.
	const nodeMain = vertical ? nodeH : nodeW;
	const nodeCross = vertical ? nodeW : nodeH;
	const stepMain = nodeMain + gapMain;
	const stepCross = nodeCross + gapCross;
	const crossSpan = layers.reduce((m, l) => Math.max(m, l.length), 1) * stepCross;

	const pos = {};
	layers.forEach((layer, r) => {
		const start = pad + (crossSpan - layer.length * stepCross) / 2;

		layer.forEach((id, i) => {
			const main = pad + r * stepMain;
			const cross = start + i * stepCross;
			pos[id] = vertical ? { x: cross, y: main } : { x: main, y: cross };
		});
	});

	return pos;
};

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

const cell = (field, label) => {
	if (!field) {
		return el("td", { class: "muted", "data-label": label }, "—");
	}

	return el("td", { "data-label": label },
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
					}, [el("td", { class: "key", "data-label": "key" }, row.key)].concat(cols.map((c) => {
						return cell(row.fields[c], c);
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

	return { nodes: nodes, edges: edges };
};

// Position a builder graph with the shared layered algorithm, oriented for the
// current viewport. Recomputed on orientation flips (see the resize handler).
const builderLayout = (graph, vertical) => {
	return layoutLayered(graph.nodes, graph.edges, {
		nodeW: NODE_W, nodeH: NODE_H,
		gapMain: COL - NODE_W, gapCross: ROW - NODE_H,
		vertical: vertical
	});
};

// Bezier wire between two nodes. Exits the "downstream" side of `a` and enters
// the matching side of `b`: right->left when the layout runs across, bottom->top
// when it runs down (phones), so the curve follows the flow instead of doubling
// back over the node.
const wirePath = (a, b, opts) => {
	const w = (opts && opts.w) || NODE_W;
	const h = (opts && opts.h) || NODE_H;

	if (opts && opts.vertical) {
		const sx = a.x + w / 2;
		const sy = a.y + h;
		const ex = b.x + w / 2;
		const ey = b.y;
		const dy = Math.max(30, Math.abs(ey - sy) * 0.5);

		return "M " + sx + "," + sy + " C " + sx + "," + (sy + dy) + " " + ex + "," + (ey - dy) + " " + ex + "," + ey;
	}

	const sx = a.x + w;
	const sy = a.y + h / 2;
	const ex = b.x;
	const ey = b.y + h / 2;
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
					d: () => { ui.frame; return wirePath(ui.pos[edge.from], ui.pos[edge.to], { vertical: ui.narrow }); }
				});
			}));
		}
	);

	const nodeEls = graph.nodes.map((node) => {
		const b = node.meta.block;

		return el("div", {
			class: () => "gnode " + node.kind + (node.kind === "block" && ui.block === b.id ? " sel" : ""),
			style: () => { ui.frame; const p = ui.pos[node.id]; return "left:" + p.x + "px;top:" + p.y + "px"; },
			onpointerdown: (e) => {
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

// --- Graph (discovery mind-map) -------------------------------------------

// Short display label from an entity key like 'name="a.com"' -> 'a.com'.
const shortLabel = (key) => {
	return String(key).replace(/^[^=]*=/, "").replace(/^"|"$/g, "");
};

const graphModel = (data, included) => {
	const nodes = [];
	const index = {};

	Object.keys(data.entities).forEach((type) => {
		if (!included[type]) {
			return;
		}

		data.entities[type].forEach((entity) => {
			const id = type + "|" + entity.key;
			const node = { id: id, type: type, key: entity.key, label: shortLabel(entity.key), row: entity };
			nodes.push(node);
			index[id] = node;
		});
	});

	const edges = data.edges.filter((edge) => {
		return index[edge.from.type + "|" + edge.from.key] && index[edge.to.type + "|" + edge.to.key];
	}).map((edge) => {
		return { from: edge.from.type + "|" + edge.from.key, to: edge.to.type + "|" + edge.to.key, rel: edge.rel };
	});

	return { nodes: nodes, edges: edges };
};

const graphView = (data, ui) => {
	const allTypes = Object.keys(data.entities);

	const chips = el("div", { class: "chips" }, allTypes.map((type) => {
		return el("button", {
			class: () => (ui.graphTypes[type] ? "chip active" : "chip"),
			onclick: () => { ui.graphTypes[type] = !ui.graphTypes[type]; ui.frame = ui.frame + 1; }
		}, type + " (" + data.entities[type].length + ")");
	}));

	// Reactive canvas: nodes+edges recomputed when type toggles change.
	const canvas = el("div", { class: "canvas" }, () => {
		ui.frame;
		const model = graphModel(data, ui.graphTypes);

		// Lay out the whole discovery graph with the layered algorithm — nodes
		// flow along the direction they were discovered, wires cross less, and
		// nothing overlaps — then keep any node the user has since dragged.
		const laid = layoutLayered(model.nodes, model.edges, {
			nodeW: GNODE_W, nodeH: GNODE_H,
			gapMain: 96, gapCross: 48,
			vertical: ui.narrow
		});

		model.nodes.forEach((node) => {
			if (!ui.pos[node.id]) { ui.pos[node.id] = laid[node.id]; }
		});

		const bounds = model.nodes.reduce((acc, n) => {
			return { w: Math.max(acc.w, ui.pos[n.id].x + GNODE_W + 40), h: Math.max(acc.h, ui.pos[n.id].y + GNODE_H + 40) };
		}, { w: 400, h: 300 });

		const marker = el("defs", {}, el("marker", {
			id: "garrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
			markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse"
		}, el("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--wire)" })));

		const edgeEls = model.edges.map((edge) => {
			const a = ui.pos[edge.from];
			const b = ui.pos[edge.to];
			const path = wirePath(a, b, { w: GNODE_W, h: GNODE_H, vertical: ui.narrow });
			const mid = {
				x: (a.x + b.x) / 2 + GNODE_W / 2,
				y: (a.y + b.y) / 2 + GNODE_H / 2
			};

			return el("g", {},
				el("path", { class: "wire", "marker-end": "url(#garrow)", d: path }),
				el("text", { class: "wire-label", x: mid.x, y: mid.y }, edge.rel));
		});

		const wires = el("svg", { class: "wires", width: bounds.w, height: bounds.h }, marker, edgeEls);

		const nodeEls = model.nodes.map((node) => {
			return el("div", {
				class: () => "gnode ent " + node.type + (ui.gsel === node.id ? " sel" : ""),
				style: () => { ui.frame; const p = ui.pos[node.id]; return "left:" + p.x + "px;top:" + p.y + "px"; },
				onpointerdown: (e) => {
					ui.gsel = node.id;
					ui.drag = { id: node.id, px: e.clientX, py: e.clientY, ox: ui.pos[node.id].x, oy: ui.pos[node.id].y };
					e.preventDefault();
				}
			},
			el("div", { class: "kind" }, node.type),
			el("div", { class: "title" }, node.label));
		});

		return el("div", { class: "stage", style: "width:" + bounds.w + "px;height:" + bounds.h + "px" }, wires, nodeEls);
	});

	const detail = el("div", { class: "side" }, () => {
		if (!ui.gsel) {
			return el("p", { class: "muted" }, "toggle types · drag nodes · click a node for its fields");
		}

		const parts = ui.gsel.split("|");
		const type = parts[0];
		const key = parts.slice(1).join("|");
		const entity = (data.entities[type] || []).find((row) => row.key === key);

		if (!entity) {
			return el("p", { class: "muted" }, ui.gsel);
		}

		return el("pre", {}, JSON.stringify(entity, null, 2));
	});

	return el("div", { class: "panel builder" },
		el("div", { class: "hint" }, "the discovery graph — nodes are entities, edges are how they were found"),
		chips, canvas, detail);
};

// --- Executions (n8n-style run log) ---------------------------------------

const STATUSES = ["all", "ok", "changed", "skipped", "error", "failed"];

// The LATEST execution per (block, entity) — a target's current state, so
// "failed" means still-failing, not failed-then-recovered.
const latestByTarget = (entries) => {
	const latest = {};

	entries.forEach((entry) => {
		const key = entry.block + "|" + (entry.entity ? entry.entity.type + "|" + entry.entity.key : "-");
		latest[key] = entry;
	});

	return Object.keys(latest).map((key) => { return latest[key]; });
};

// The retry queue: targets whose final state is an error.
const failedEntries = (entries) => {
	return latestByTarget(entries).filter((entry) => { return entry.status === "error"; });
};

// Does an execution entry pass the current status filter chip? ("failed" is
// handled separately since it needs the whole set to find the latest.)
const matchesStatus = (entry, filter) => {
	if (filter === "all") { return true; }
	if (filter === "changed") { return entry.status === "ok" && entry.changed; }

	return entry.status === filter;
};

const executionsView = (data, ui) => {
	const all = data.executions || [];

	const failed = failedEntries(all);

	const counts = {
		all: all.length,
		ok: all.filter((e) => e.status === "ok").length,
		changed: all.filter((e) => e.status === "ok" && e.changed).length,
		skipped: all.filter((e) => e.status === "skipped").length,
		error: all.filter((e) => e.status === "error").length,
		failed: failed.length
	};

	const chips = el("div", { class: "chips" }, STATUSES.map((status) => {
		return el("button", {
			class: () => (ui.exStatus === status ? "chip active" : "chip"),
			onclick: () => { ui.exStatus = status; ui.exSel = null; }
		}, status + " (" + counts[status] + ")");
	}));

	// "failed" is the deduped latest-per-target error set (the retry queue);
	// every other chip filters the raw execution stream.
	const rows = () => {
		const withIndex = all.map((entry, index) => { return Object.assign({ _i: index }, entry); });

		if (ui.exStatus === "failed") {
			const failedIds = new Set(failed.map((entry) => { return entry.id; }));

			return withIndex.filter((entry) => { return failedIds.has(entry.id); }).reverse();
		}

		return withIndex.filter((entry) => { return matchesStatus(entry, ui.exStatus); }).reverse();
	};

	// Retry affordance for the whole failed set (honoured by the served backend).
	const retryBar = () => {
		if (failed.length === 0) {
			return el("span", {});
		}

		return el("button", {
			class: "rerun",
			title: "re-run every target whose final state is an error",
			onclick: () => {
				if (ui.served) {
					ui.api("POST", "/api/executions/rerun-failed").then(ui.refresh);
					return;
				}

				ui.exStatus = "failed";
				ui.exRerunAll = true;
			}
		}, "⟳ re-run all failed (" + failed.length + ")");
	};

	const statusPill = (entry) => {
		const kind = (entry.status === "ok" && entry.changed) ? "changed" : entry.status;

		return el("span", { class: "pill pill-" + kind }, kind);
	};

	const table = el("div", { class: "scroll" },
		el("table", {},
			el("thead", {}, el("tr", {},
				el("th", {}, "block"),
				el("th", {}, "uses"),
				el("th", {}, "entity"),
				el("th", {}, "status"),
				el("th", {}, "sweep"),
				el("th", {}, "ms"))),
			el("tbody", {}, list(
				rows,
				(entry) => entry.id || String(entry._i),
				(entry) => {
					return el("tr", {
						class: () => (ui.exSel === entry._i ? "row sel" : "row"),
						onclick: () => { ui.exSel = entry._i; }
					},
					el("td", { class: "key", "data-label": "block" }, entry.block),
					el("td", { "data-label": "uses" }, el("div", { class: "val" }, entry.uses || "—")),
					el("td", { "data-label": "entity" }, el("div", { class: "val" }, entry.entity ? entry.entity.key : "—")),
					el("td", { "data-label": "status" }, statusPill(entry)),
					el("td", { "data-label": "sweep" }, el("div", { class: "val" }, String(entry.sweep || "—"))),
					el("td", { "data-label": "ms" }, el("div", { class: "val" }, entry.duration_ms === undefined ? "—" : String(entry.duration_ms))));
				}
			))
		)
	);

	// Detail pane: the selected execution's input + output (the n8n "click a
	// node run to see its data" view) + a re-run affordance.
	const detail = el("div", { class: "lineage" }, () => {
		if (ui.exSel === null || ui.exSel === undefined) {
			return el("p", { class: "muted" }, "select an execution to see its input / output");
		}

		const entry = all[ui.exSel];

		if (!entry) {
			return el("p", { class: "muted" }, "gone");
		}

		const blocks = [];

		blocks.push(el("div", { class: "hint" },
			entry.block + " · " + (entry.uses || "") + " · " +
			(entry.entity ? entry.entity.type + " " + entry.entity.key : "")));

		// Re-run: replay this block against this entity. Served -> hits the API
		// and reloads; static artifact -> a note (no backend to run against).
		blocks.push(el("button", {
			class: "rerun",
			title: "replay this block against this entity",
			onclick: () => {
				if (ui.served) {
					ui.api("POST", "/api/executions/" + entry.id + "/rerun").then(ui.refresh);
					return;
				}

				ui.exRerun = entry.id;
				ui.frame = ui.frame + 1;
			}
		}, "⟳ re-run"));

		if (!ui.served && ui.exRerun === entry.id) {
			blocks.push(el("p", { class: "muted" }, "re-run needs the served app (yarn web) — this is a static export"));
		}

		if (entry.error) {
			blocks.push(el("h3", {}, "error"));
			blocks.push(el("pre", { class: "err-pre" }, entry.error));
		}

		blocks.push(el("h3", {}, "input"));
		blocks.push(el("pre", {}, JSON.stringify(entry.input || {}, null, 2)));
		blocks.push(el("h3", {}, "output"));
		blocks.push(el("pre", {}, JSON.stringify(entry.output === undefined ? {} : entry.output, null, 2)));

		return el("div", {}, blocks);
	});

	const banner = () => {
		if (ui.served || !ui.exRerunAll || failed.length === 0) {
			return el("span", {});
		}

		return el("p", { class: "muted" },
			failed.length + " failed target(s) — run the served app (yarn web) to re-run them");
	};

	return el("div", { class: "panel" },
		el("div", { class: "hint" }, "every block execution this run — input, output, whether it changed the entity, and timing"),
		chips, retryBar(), banner(), table, el("h3", {}, "detail"), detail);
};

// --- Playbooks (draft/active/paused lifecycle) ----------------------------

const PB_STATES = ["draft", "active", "paused"];

// naive flow-name from YAML metadata.name (frontend has no loader).
const nameFromYaml = (yaml) => {
	const match = String(yaml || "").match(/name:\s*["']?([^\s"'#]+)/);

	return match ? match[1] : "imported";
};

const playbooksView = (data, ui) => {
	const cycle = (book) => {
		const next = PB_STATES[(PB_STATES.indexOf(book.state) + 1) % PB_STATES.length];

		if (ui.served) {
			ui.api("POST", "/api/playbooks/" + book.id + "/state", { state: next }).then(ui.refresh);
			return;
		}

		book.state = next;
		ui.frame = ui.frame + 1;
	};

	// Run a playbook now (served): converge it once, then reload — you'll see its
	// entities in Explorer/Graph and rows in Executions.
	const runNow = (book) => {
		if (!ui.served) { return; }
		ui.api("POST", "/api/playbooks/" + book.id + "/run").then(ui.refresh);
	};

	const table = el("div", { class: "scroll" },
		el("table", {},
			el("thead", {}, el("tr", {},
				el("th", {}, "name"), el("th", {}, "state"),
				el("th", {}, "schedule"), el("th", {}, "valid"), el("th", {}, "last run"),
				el("th", {}, ""))),
			el("tbody", {}, () => {
				ui.frame;

				return el("g", {}, ui.playbooks.map((book) => {
					return el("tr", {
						class: () => (ui.pbSel === book.id ? "row sel" : "row"),
						onclick: () => { ui.pbSel = book.id; ui.pbExport = null; }
					},
					el("td", { class: "key", "data-label": "name" }, book.name),
					el("td", { "data-label": "state" }, el("button", {
						class: "pill pill-pb-" + book.state,
						title: "click to cycle draft → active → paused",
						onclick: (e) => { e.stopPropagation(); cycle(book); }
					}, book.state)),
					el("td", { "data-label": "schedule" }, el("div", { class: "val" }, book.schedule || "—")),
					el("td", { "data-label": "valid" }, el("div", { class: "val" }, book.valid === false ? "✗" : "✓")),
					el("td", { "data-label": "last run" }, el("div", { class: "val" }, book.last_run_at || "—")),
					el("td", { "data-label": "" }, ui.served
						? el("button", {
							class: "rerun", title: "run this playbook now",
							onclick: (e) => { e.stopPropagation(); runNow(book); }
						}, "▶ run")
						: el("span", { class: "muted" }, "—")));
				}));
			})
		)
	);

	const detail = el("div", { class: "lineage" }, () => {
		ui.frame;

		if (!ui.pbSel) {
			return el("p", { class: "muted" }, "select a playbook — cycle its state, or export it");
		}

		const book = ui.playbooks.find((b) => b.id === ui.pbSel);

		if (!book) {
			return el("p", { class: "muted" }, "gone");
		}

		const parts = [
			el("button", { class: "rerun", onclick: () => { ui.pbExport = JSON.stringify({ convergencePlaybook: 1, name: book.name, schedule: book.schedule, yaml: book.yaml }, null, 2); ui.frame = ui.frame + 1; } }, "⇩ export")
		];

		if (ui.pbExport) {
			parts.push(el("h3", {}, "portable artifact"));
			parts.push(el("pre", {}, ui.pbExport));
		}

		parts.push(el("h3", {}, "flow yaml"));
		parts.push(el("pre", { class: "yaml" }, book.yaml || "(empty)"));

		return el("div", {}, parts);
	});

	// Import: paste a portable artifact JSON or a bare flow YAML.
	const importBox = el("textarea", {
		class: "in", placeholder: "paste a playbook artifact (JSON) or a flow YAML…",
		oninput: (e) => { ui.pbImportText = e.target.value; }
	});

	const importBtn = el("button", { class: "rerun", onclick: () => {
		const text = String(ui.pbImportText || "").trim();
		if (!text) { return; }

		let name;
		let yaml;
		let schedule = null;

		try {
			const parsed = JSON.parse(text);
			yaml = parsed.yaml || "";
			name = parsed.name || nameFromYaml(yaml);
			schedule = parsed.schedule || null;
		} catch {
			yaml = text;
			name = nameFromYaml(text);
		}

		if (ui.served) {
			ui.api("POST", "/api/playbooks/import", { name: name, schedule: schedule, yaml: yaml })
				.then(() => { ui.pbImportText = ""; return ui.refresh(); });
			return;
		}

		ui.playbooks.push({
			id: "pb-" + (ui.playbooks.length + 1),
			name: name, state: "draft", schedule: schedule, valid: true, yaml: yaml, last_run_at: null
		});
		ui.pbImportText = "";
		ui.frame = ui.frame + 1;
	} }, "⇧ import as draft");

	// Sample gallery: one-click import of the bundled example flows.
	const samplesEl = el("div", { class: "chips" }, (data.samples || []).map((sample) => {
		return el("button", {
			class: "chip", title: sample.description || sample.name,
			onclick: () => {
				if (ui.served) {
					ui.api("POST", "/api/playbooks/import", { name: sample.name, yaml: sample.yaml }).then(ui.refresh);
					return;
				}

				ui.playbooks.push({
					id: "pb-" + (ui.playbooks.length + 1), name: sample.name, state: "draft",
					schedule: null, valid: true, yaml: sample.yaml, last_run_at: null
				});
				ui.frame = ui.frame + 1;
			}
		}, "＋ " + sample.name);
	}));

	return el("div", { class: "panel" },
		el("div", { class: "hint" }, "saved flows with a lifecycle — click a state to cycle draft → active → paused; export/import as portable artifacts"),
		table,
		el("h3", {}, "sample playbooks"),
		(data.samples && data.samples.length > 0)
			? samplesEl
			: el("p", { class: "muted" }, "no samples bundled"),
		el("h3", {}, "import"),
		el("div", { class: "editor" }, importBox, importBtn),
		el("h3", {}, "detail"), detail);
};

// --- Shell ----------------------------------------------------------------

export const render = (root, data) => {
	const graph = computeGraph(data.spec || { entities: {}, sources: [], blocks: [] });

	const entityTypes = Object.keys(data.entities);

	// Graph view includes every type except very high-count ones (e.g. cert)
	// by default, so the mind-map stays legible; toggle any on.
	const graphTypes = {};
	entityTypes.forEach((type) => {
		graphTypes[type] = data.entities[type].length <= 50;
	});

	const narrow = isNarrow();

	// Playbooks come from the data if present; otherwise seed one "active" from
	// the current flow so the tab is meaningful in a static export.
	const seedPlaybooks = (data.playbooks && data.playbooks.length > 0)
		? data.playbooks.map((book) => Object.assign({}, book))
		: (data.yaml ? [{
			id: "pb-1", name: data.flow || "flow", state: "active",
			schedule: null, valid: true, yaml: data.yaml, last_run_at: null
		}] : []);

	// Land on Explorer when there's data to explore, otherwise on Playbooks (the
	// home) — a fresh served app has no entities until a playbook runs. A refresh
	// passes __view to stay put.
	const hasEntities = Object.keys(data.entities || {}).some((type) => {
		return (data.entities[type] || []).length > 0;
	});

	const ui = state({
		view: data.__view || (hasEntities ? "explorer" : "playbooks"),
		served: Boolean(data.__served),
		playbooks: seedPlaybooks,
		pbSel: data.__pbSel || null,
		pbExport: null,
		pbImportText: "",
		type: entityTypes.indexOf("host") !== -1 ? "host" : entityTypes[0],
		query: "",
		selected: null,
		block: null,
		graph: graph,
		pos: builderLayout(graph, narrow),
		spec: data.spec,
		graphTypes: graphTypes,
		gsel: null,
		narrow: narrow,
		exStatus: "all",
		exSel: null,
		exRerun: null,
		exRerunAll: false,
		frame: 0,
		drag: null
	});

	// Re-lay-out on an orientation flip (portrait phone <-> wider). Only fires
	// when narrow-ness actually changes, and re-seeds positions for BOTH graphs:
	// the builder immediately, the discovery graph lazily (its ids drop out of
	// ui.pos and get re-placed on next render).
	if (typeof window !== "undefined" && window.addEventListener) {
		window.addEventListener("resize", () => {
			const nowNarrow = isNarrow();
			if (nowNarrow === ui.narrow) { return; }

			ui.narrow = nowNarrow;
			ui.pos = builderLayout(ui.graph, nowNarrow);
			ui.frame = ui.frame + 1;
		});
	}

	// Served-mode API bridge: call the app's REST API, then reload the whole
	// snapshot and re-render (reflects entity/execution/playbook changes).
	ui.api = (method, apiPath, body) => {
		return fetch(apiPath, {
			method: method,
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		}).then((response) => { return response.json(); });
	};

	ui.refresh = () => {
		return fetch("/api/snapshot")
			.then((response) => { return response.json(); })
			.then((fresh) => {
				fresh.__served = true;
				// Preserve where the user was (view + selected playbook) across the
				// re-render, so an action doesn't bounce them to another tab.
				fresh.__view = ui.view;
				fresh.__pbSel = ui.pbSel;
				root.innerHTML = "";
				render(root, fresh);
			});
	};

	// Dragging via POINTER events so it works with mouse AND touch. Document-
	// level so the pointer can leave the node mid-drag.
	document.addEventListener("pointermove", (e) => {
		if (!ui.drag) { return; }
		ui.pos[ui.drag.id].x = ui.drag.ox + (e.clientX - ui.drag.px);
		ui.pos[ui.drag.id].y = ui.drag.oy + (e.clientY - ui.drag.py);
		ui.frame = ui.frame + 1;
	});
	document.addEventListener("pointerup", () => { ui.drag = null; });

	// Playbooks first — it's the home (pick/import/activate a flow); the rest show
	// what your active playbooks have discovered.
	const tabs = el("div", { class: "tabs" },
		el("button", {
			class: () => (ui.view === "playbooks" ? "tab active" : "tab"),
			onclick: () => { ui.view = "playbooks"; }
		}, "Playbooks (" + ui.playbooks.length + ")"),
		el("button", {
			class: () => (ui.view === "explorer" ? "tab active" : "tab"),
			onclick: () => { ui.view = "explorer"; }
		}, "Explorer"),
		el("button", {
			class: () => (ui.view === "graph" ? "tab active" : "tab"),
			onclick: () => { ui.view = "graph"; }
		}, "Graph"),
		el("button", {
			class: () => (ui.view === "executions" ? "tab active" : "tab"),
			onclick: () => { ui.view = "executions"; }
		}, "Executions (" + ((data.executions || []).length) + ")"),
		el("button", {
			class: () => (ui.view === "builder" ? "tab active" : "tab"),
			onclick: () => { ui.view = "builder"; }
		}, "Flow builder")
	);

	const views = {
		explorer: () => explorer(data, ui),
		builder: () => builder(data, ui),
		executions: () => executionsView(data, ui),
		playbooks: () => playbooksView(data, ui),
		graph: () => graphView(data, ui)
	};

	const body = el("div", {}, when(() => ui.view, (view) => views[view]()));

	const app = el("div", { class: "app" },
		el("header", {},
			el("h1", {}, "convergence"),
			el("span", { class: "flow" }, data.flow)),
		tabs,
		body);

	root.appendChild(app);

	return app;
};
