// convergence frontend (qrp) — two surfaces over one flow result:
//   - Explorer: entity tables with per-field provenance + a query box + lineage
//   - Builder:  an n8n-style node canvas — source/blocks/entities wired by the
//     real dataflow, draggable, with an inspector + YAML
//
// ESM by nature (qrp is ESM). `render(root, data)` has no top-level side effects
// so it runs both in the browser (frontend/entry.js) and under happy-dom in Node
// (frontend/__tests__), which is how the UI is verified without a browser.

import { state, el, list, when, router, navigate } from "@nemanjan00/qrp";
import { dump as dumpYamlLib, load as loadYamlLib } from "js-yaml";

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

// A friendly empty state with an optional call-to-action button.
const emptyState = (icon, title, sub, action) => {
	const kids = [
		el("div", { class: "empty-icon" }, icon),
		el("div", { class: "empty-title" }, title),
		el("div", { class: "empty-sub" }, sub)
	];

	if (action) {
		kids.push(el("button", { class: "btn btn-accent", onclick: action.onClick }, action.label));
	}

	return el("div", { class: "empty" }, kids);
};

// The at-a-glance summary bar under the header: what the app currently knows.
const statBar = (data, ui) => {
	const entityCount = Object.keys(data.entities || {}).reduce((sum, type) => {
		return sum + (data.entities[type] || []).length;
	}, 0);
	const typeCount = Object.keys(data.entities || {}).filter((type) => {
		return (data.entities[type] || []).length > 0;
	}).length;
	const active = ui.playbooks.filter((book) => { return book.state === "active"; }).length;

	const stat = (value, label, cls) => {
		return el("div", { class: "stat" },
			el("div", { class: "stat-val" }, el("span", { class: cls || "" }, String(value))),
			el("div", { class: "stat-label" }, label));
	};

	return el("div", { class: "statbar" },
		stat(entityCount, "entities", "good"),
		stat(typeCount, "types"),
		stat((data.edges || []).length, "edges"),
		stat((data.executions || []).length, "executions"),
		stat(ui.playbooks.length, "playbooks"),
		stat(active, "active", "accent"));
};

const explorer = (data, ui) => {
	const types = Object.keys(data.entities);

	// Nothing discovered yet — point the user at the Playbooks home.
	if (types.length === 0 || types.every((type) => { return data.entities[type].length === 0; })) {
		return el("div", { class: "panel" }, emptyState(
			"🔍", "No entities yet",
			"Entities show up here once a playbook runs. Head to Playbooks, activate one (or import a sample), and hit Run.",
			{ label: "Go to Playbooks", onClick: () => { ui.view = "playbooks"; } }));
	}

	// Index entities + build the lineage adjacency (parent -> child edges).
	const idOf = (type, key) => { return type + "|" + key; };
	const byId = {};
	types.forEach((type) => {
		(data.entities[type] || []).forEach((entity) => { byId[idOf(type, entity.key)] = { type: type, key: entity.key, entity: entity }; });
	});

	const children = {};
	const parents = {};
	(data.edges || []).forEach((edge) => {
		const from = idOf(edge.from.type, edge.from.key);
		const to = idOf(edge.to.type, edge.to.key);
		(children[from] = children[from] || []).push({ id: to, rel: edge.rel });
		(parents[to] = parents[to] || []).push({ id: from, rel: edge.rel });
	});

	const typeOf = (id) => { return byId[id] ? byId[id].type : id.split("|")[0]; };
	const labelOf = (id) => { return byId[id] ? shortLabel(byId[id].key) : id.split("|").slice(1).join("|"); };
	const select = (id) => { ui.selected = id; ui.frame = ui.frame + 1; };
	const formatVal = (v) => { return String(JSON.stringify(v)).replace(/^"|"$/g, ""); };

	const search = el("input", {
		class: "search", type: "search", placeholder: "filter entities…",
		oninput: (e) => { ui.query = e.target.value; }
	});

	const modeToggle = el("div", { class: "seg" }, ["tree", "table"].map((mode) => {
		return el("button", {
			class: () => (ui.exploreMode === mode ? "seg-btn active" : "seg-btn"),
			onclick: () => { ui.exploreMode = mode; ui.frame = ui.frame + 1; }
		}, mode);
	}));

	// --- TREE: drill parent -> child along the lineage (certs -> hosts -> ips
	// -> orgs, domains -> emails, …). Cycle-guarded via the ancestor path. ---
	const treeNode = (id, rel, path) => {
		const kids = children[id] || [];
		const cyclic = path.has(id);
		const expandable = kids.length > 0 && !cyclic;
		const isOpen = ui.expanded[id];

		const row = el("div", {
			class: () => "tnode" + (ui.selected === id ? " sel" : ""),
			style: "padding-left:" + (path.size * 16) + "px"
		},
		expandable
			? el("button", { class: "caret", onclick: (e) => { e.stopPropagation(); ui.expanded[id] = !ui.expanded[id]; ui.frame = ui.frame + 1; } }, isOpen ? "▾" : "▸")
			: el("span", { class: "caret" }, "·"),
		rel ? el("span", { class: "trel" }, rel + "→") : el("span", {}),
		el("span", { class: "tbadge " + typeOf(id) }, typeOf(id)),
		el("span", { class: "tlabel", onclick: () => { select(id); } }, labelOf(id)),
		cyclic ? el("span", { class: "muted", title: "already shown above" }, "↻") : el("span", {}));

		if (!isOpen || cyclic) { return row; }

		const childPath = new Set(path);
		childPath.add(id);

		return el("div", {}, [row].concat(kids.map((k) => { return treeNode(k.id, k.rel, childPath); })));
	};

	// Top level = entity-TYPE groups (so every type is visible up top, even ones
	// that are always children like a host materialized from an ip). Expanding a
	// group lists its entities; expanding an entity follows the lineage.
	const typeGroup = (type) => {
		const gkey = "T:" + type;
		const ents = (data.entities[type] || []).filter((e) => { return matchesQuery(e, ui.query); });
		const open = ui.expanded[gkey] !== undefined ? ui.expanded[gkey] : ents.length <= 100;
		const toggle = (e) => { e.stopPropagation(); ui.expanded[gkey] = !open; ui.frame = ui.frame + 1; };

		const row = el("div", { class: "tnode tgroup" },
			el("button", { class: "caret", onclick: toggle }, open ? "▾" : "▸"),
			el("span", { class: "tbadge " + type }, type),
			el("span", { class: "tlabel", onclick: toggle }, type),
			el("span", { class: "count" }, String(ents.length)));

		if (!open) { return row; }
		if (ents.length === 0) { return el("div", {}, [row, el("div", { class: "muted", style: "padding-left:18px" }, "no matches")]); }

		return el("div", {}, [row].concat(ents.map((e) => { return treeNode(idOf(type, e.key), null, new Set([gkey])); })));
	};

	const tree = el("div", { class: "tree scroll" }, () => {
		ui.frame;
		const groups = types.filter((t) => { return (data.entities[t] || []).length > 0; }).sort();

		if (groups.length === 0) { return el("p", { class: "muted" }, "no entities"); }

		return el("div", {}, groups.map(typeGroup));
	});

	// --- TABLE: dense per-type view (existing). ---
	const typeTabs = el("div", { class: "chips" }, types.map((type) => {
		return el("button", { class: () => (ui.type === type ? "chip active" : "chip"), onclick: () => { ui.type = type; ui.frame = ui.frame + 1; } },
			type + " (" + data.entities[type].length + ")");
	}));

	const table = el("div", {},
		typeTabs,
		el("div", { class: "scroll" }, el("table", {},
			el("thead", {}, () => {
				const cols = columnsFor(data.entities[ui.type] || []);
				return el("tr", {}, [el("th", {}, "key")].concat(cols.map((c) => { return el("th", {}, c); })));
			}),
			el("tbody", {}, list(
				() => { return (data.entities[ui.type] || []).filter((r) => matchesQuery(r, ui.query)); },
				(row) => ui.type + "|" + row.key,
				(row) => {
					const cols = columnsFor(data.entities[ui.type] || []);
					return el("tr", {
						class: () => (ui.selected === idOf(ui.type, row.key) ? "row sel" : "row"),
						onclick: () => { select(idOf(ui.type, row.key)); }
					}, [el("td", { class: "key", "data-label": "key" }, row.key)].concat(cols.map((c) => { return cell(row.fields[c], c); })));
				}
			))
		)));

	// --- DETAIL: the selected entity's fields + provenance + navigable relations.
	const relLink = (edge) => {
		return el("div", { class: "rellink", onclick: () => { select(edge.id); } },
			el("span", { class: "trel" }, edge.rel + "→"),
			el("span", { class: "tbadge " + typeOf(edge.id) }, typeOf(edge.id)),
			el("span", { class: "tlabel" }, labelOf(edge.id)));
	};

	const detail = el("div", { class: "detail" }, () => {
		ui.frame;

		if (!ui.selected || !byId[ui.selected]) {
			return el("p", { class: "muted" }, "select an entity to inspect its fields, provenance and relations");
		}

		const node = byId[ui.selected];
		const entity = node.entity;
		const parts = [ el("div", { class: "d-head" },
			el("span", { class: "tbadge " + node.type }, node.type),
			el("span", { class: "d-key" }, node.key)) ];

		Object.keys(entity.fields).forEach((name) => {
			const f = entity.fields[name];
			parts.push(el("div", { class: "dfield" },
				el("span", { class: "dk" }, name),
				el("span", { class: "dv" }, formatVal(f.value)),
				el("span", { class: "prov" }, f.block)));
		});

		const ps = parents[ui.selected] || [];
		const cs = children[ui.selected] || [];
		if (ps.length > 0) { parts.push(el("h3", {}, "parent of ← discovered from")); ps.forEach((p) => { parts.push(relLink(p)); }); }
		if (cs.length > 0) { parts.push(el("h3", {}, "led to →")); cs.forEach((c) => { parts.push(relLink(c)); }); }

		return el("div", {}, parts);
	});

	return el("div", { class: "panel" },
		el("div", { class: "toolbar" }, modeToggle, search),
		el("div", { class: "explorer-split" },
			el("div", {}, when(() => ui.exploreMode, (mode) => (mode === "table" ? table : tree))),
			detail));
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

// Category icon for a block `uses` (first segment), for the palette + nodes.
const BLOCK_ICONS = {
	dns: "🌐", http: "🌍", tls: "🔒", ip: "📍", mail: "✉", rdap: "📖", port: "🔌",
	ct: "🔎", passive: "🔎", ti: "⚠", asn: "🛰", internetdb: "🛰", cert: "🔒",
	url: "🔗", email: "✉", hash: "#", decode: "🔁", refang: "🧬", regex: "🔤",
	map: "🗺", filter: "⛃", fanout: "💥", webhook: "🪝", js: "🧩", cli: "⌘", exif: "🖼", log: "📄"
};
const blockIcon = (uses) => { return BLOCK_ICONS[String(uses || "").split(".")[0]] || "◆"; };

const builder = (data, ui) => {
	// Structural changes (add/delete a block) bump ui.topo so the node layer
	// rebuilds from the recomputed graph; drags only bump ui.frame (positions).
	const stageW = () => { ui.topo; ui.frame; return Math.max.apply(null, ui.graph.nodes.map((n) => { return (ui.pos[n.id] ? ui.pos[n.id].x : 0) + NODE_W + 60; }).concat([420])); };
	const stageH = () => { ui.topo; ui.frame; return Math.max.apply(null, ui.graph.nodes.map((n) => { return (ui.pos[n.id] ? ui.pos[n.id].y : 0) + NODE_H + 60; }).concat([320])); };

	const recompute = () => {
		ui.graph = computeGraph(ui.spec);
		const laid = builderLayout(ui.graph, ui.narrow);
		ui.graph.nodes.forEach((n) => { if (!ui.pos[n.id]) { ui.pos[n.id] = laid[n.id]; } });
		ui.topo = ui.topo + 1;
		ui.dirty = true;
		ui.frame = ui.frame + 1;
	};

	// Mark the flow dirty (unsaved) after any edit + bump the reactive frame.
	const touch = () => { ui.dirty = true; ui.frame = ui.frame + 1; };

	// Explicit save — NO autosave. Writes the edited YAML back to the open
	// playbook (re-validated server-side); local fallback for the static export.
	const saveFlow = () => {
		const yaml = dumpYaml(ui.spec);

		if (ui.served && ui.openPlaybook) {
			ui.api("PUT", "/api/playbooks/" + ui.openPlaybook, { yaml: yaml }).then((res) => {
				ui.dirty = false;
				const ok = !res || res.valid !== false;
				return ui.refresh({ kind: ok ? "ok" : "err", msg: ok ? "Flow saved" : "Saved but INVALID: " + ((res.errors || []).join("; ") || "check the flow") });
			});
			return;
		}

		const book = ui.playbooks.find((x) => { return x.id === ui.openPlaybook; });
		if (book) { book.yaml = yaml; }
		ui.dirty = false;
		ui.toast = { kind: "ok", msg: "Flow saved (local)" };
		ui.frame = ui.frame + 1;
	};

	const saveBar = el("div", { class: "save-bar" },
		el("button", { class: () => (ui.dirty ? "btn btn-accent" : "btn"), onclick: saveFlow }, "💾 Save flow"),
		() => (ui.dirty ? el("span", { class: "dirty" }, "● unsaved changes") : el("span", { class: "muted" }, "no unsaved changes")));

	const addBlock = (uses) => {
		const ents = Object.keys(ui.spec.entities || {});
		const target = ents.indexOf("host") !== -1 ? "host" : (ents[0] || "host");
		const base = "b-" + String(uses).replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/-+$/, "");
		const ids = new Set((ui.spec.blocks || []).map((b) => { return b.id; }));
		let id = base;
		let n = 1;
		while (ids.has(id)) { n = n + 1; id = base + "-" + n; }

		ui.spec.blocks = (ui.spec.blocks || []).concat([{ id: id, uses: uses, for_each: target, merge_into: target, inputs: {} }]);
		ui.block = id;
		recompute();
	};

	const deleteBlock = (id) => {
		ui.spec.blocks = (ui.spec.blocks || []).filter((b) => { return b.id !== id; });
		if (ui.block === id) { ui.block = null; }
		recompute();
	};

	const wires = el("svg", { class: "wires", width: stageW, height: stageH },
		el("defs", {},
			el("marker", {
				id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
				markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse"
			}, el("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--wire)" }))
		),
		// Reactive edge layer: recomputed on topology (add/delete) or position change.
		() => {
			ui.frame; ui.topo;

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

	const nodeEl = (node) => {
		const b = node.meta.block;

		return el("div", {
			class: () => "gnode " + node.kind + (node.kind === "block" && ui.block === b.id ? " sel" : ""),
			style: () => { ui.frame; const p = ui.pos[node.id] || { x: 0, y: 0 }; return "left:" + p.x + "px;top:" + p.y + "px"; },
			onpointerdown: (e) => {
				if (node.kind === "block") { ui.block = b.id; ui.frame = ui.frame + 1; }
				ui.drag = { id: node.id, px: e.clientX, py: e.clientY, ox: (ui.pos[node.id] || {}).x || 0, oy: (ui.pos[node.id] || {}).y || 0 };
				e.preventDefault();
			},
			ondblclick: () => {
				if (node.kind !== "block") { return; }
				if (b.uses === "log" && ui.openBlockLog) { ui.openBlockLog(b); } else if (ui.openBlockEditor) { ui.openBlockEditor(b); }
			}
		},
		el("div", { class: "port in" }),
		el("div", { class: "port out" }),
		el("div", { class: "kind" }, node.kind),
		el("div", { class: "title" }, (node.kind === "block" ? blockIcon(b.uses) + " " : "") + node.title),
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
	};

	const canvas = el("div", { class: "canvas" },
		el("div", { class: "stage", style: () => { ui.frame; ui.topo; return "width:" + stageW() + "px;height:" + stageH() + "px"; } },
			wires,
			el("div", {}, () => { ui.topo; return ui.graph.nodes.map(nodeEl); })));

	// Block palette — search + click to add (icons per category). Fed by the
	// snapshot's block library.
	const palette = el("div", {},
		el("input", { class: "search", type: "search", placeholder: "add a block…", oninput: (e) => { ui.palQuery = e.target.value; ui.frame = ui.frame + 1; } }),
		el("div", { class: "palette" }, () => {
			ui.frame;
			const lib = (data.library && data.library.blocks) || [];

			if (lib.length === 0) { return el("p", { class: "muted" }, "block library unavailable (the served app provides it)"); }

			const qy = String(ui.palQuery || "").toLowerCase();
			const items = lib
				.filter((b) => { return (b.uses + " " + (b.describe || "")).toLowerCase().indexOf(qy) !== -1; })
				.sort((a, b) => { return a.uses < b.uses ? -1 : 1; });

			return el("div", {}, items.map((b) => {
				return el("button", { class: "pal-item", title: "add " + b.uses, onclick: () => { addBlock(b.uses); } },
					el("span", { class: "pal-ico" }, blockIcon(b.uses)),
					el("div", { class: "pal-text" },
						el("div", { class: "pal-name" }, b.uses),
						b.describe ? el("div", { class: "pal-desc" }, b.describe) : el("span", {})));
			}));
		}));

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

					if (text === "") { delete block[key]; err.msg = ""; touch(); return; }

					try {
						block[key] = JSON.parse(text);
						err.msg = "";
						touch();
					} catch {
						err.msg = "invalid JSON — not applied";
					}
				}
			}, JSON.stringify(block[key] || {}, null, 2)),
			() => (err.msg ? el("div", { class: "err" }, err.msg) : ""));
	};

	const libMeta = (uses) => { return ((data.library && data.library.blocks) || []).find((b) => { return b.uses === uses; }) || {}; };

	// The editor FORM for one block — hosted in a modal (opened by double-click or
	// the Edit button). Live: edits mutate the spec + bump frame; canvas/YAML follow.
	const editorForm = (block) => {
		const options = (current) => { return Object.keys(ui.spec.entities || {}).map((t) => { return el("option", { value: t, selected: t === current }, t); }); };
		const meta = libMeta(block.uses);
		const parts = [];

		if (meta.example) {
			parts.push(el("div", { class: "example" },
				el("div", { class: "ex" }, el("div", { class: "dk" }, "example in"), el("pre", {}, JSON.stringify(meta.example.in, null, 2))),
				el("div", { class: "ex" }, el("div", { class: "dk" }, "example out"), el("pre", {}, JSON.stringify(meta.example.out, null, 2)))));
		}

		parts.push(field("uses", el("input", { class: "in", value: block.uses, oninput: (e) => { block.uses = e.target.value; touch(); } })));
		parts.push(field("for_each", el("select", { class: "in", onchange: (e) => { block.for_each = e.target.value; touch(); } }, options(block.for_each))));
		parts.push(field("merge_into", el("select", { class: "in", onchange: (e) => { block.merge_into = e.target.value; touch(); } }, options(block.merge_into))));
		parts.push(field("relation", el("input", { class: "in", value: block.relation || "", oninput: (e) => { const v = e.target.value.trim(); if (v) { block.relation = v; } else { delete block.relation; } touch(); } })));
		parts.push(jsonField("when (sift query)", block, "when"));
		parts.push(jsonField("inputs", block, "inputs"));
		parts.push(jsonField("rate", block, "rate"));
		parts.push(el("button", { class: "btn", title: "remove this block", onclick: () => { ui.modal = null; deleteBlock(block.id); } }, "🗑 delete block"));

		return el("div", { class: "editor" }, parts);
	};

	const openEditor = (block) => {
		ui.block = block.id;
		ui.modal = { key: "edit:" + block.id, title: "edit " + block.id, ico: blockIcon(block.uses), describe: libMeta(block.uses).describe, content: editorForm(block) };
		ui.frame = ui.frame + 1;
	};

	// A `log` block's own log: everything that flowed through it (its executions'
	// recorded input), newest first.
	const openLog = (block) => {
		ui.block = block.id;
		const logs = (data.executions || []).filter((e) => { return e.block === block.id; }).slice().reverse();

		const content = logs.length > 0
			? el("div", { class: "logview" }, logs.slice(0, 100).map((e) => {
				return el("div", { class: "logrow" },
					el("div", { class: "logmeta" }, (e.entity ? e.entity.key : "") + "  ·  sweep " + (e.sweep || "-")),
					el("pre", {}, JSON.stringify(e.input || {}, null, 2)));
			}))
			: el("p", { class: "muted" }, "nothing logged yet — activate/run the playbook; this block records whatever flows through it.");

		ui.modal = { key: "log:" + block.id, title: "log · " + block.id, ico: "📄", describe: "what flowed through this log block (" + logs.length + " entries)", content: content };
		ui.frame = ui.frame + 1;
	};

	ui.openBlockEditor = openEditor;
	ui.openBlockLog = openLog;

	return el("div", { class: "panel builder" },
		el("div", { class: "hint" }, "source → blocks → entities · drag to arrange · double-click a block to edit · add blocks from the palette →"),
		saveBar,
		canvas,
		el("div", { class: "side" },
			el("h3", {}, "add block"),
			palette,
			el("h3", {}, "selected block"),
			el("div", { class: "inspector" }, () => {
				ui.frame;
				const block = (ui.spec.blocks || []).find((x) => { return x.id === ui.block; });

				if (!block) { return el("p", { class: "muted" }, "double-click a block on the canvas to edit it"); }

				const actions = [
					el("button", { class: "btn btn-accent", onclick: () => { openEditor(block); } }, "✎ edit")
				];
				if (block.uses === "log") {
					actions.push(el("button", { class: "btn", onclick: () => { openLog(block); } }, "📄 view log"));
				}
				actions.push(el("button", { class: "btn", onclick: () => { deleteBlock(block.id); } }, "🗑 delete"));

				return el("div", { class: "sel-block" },
					el("div", { class: "editor-head" }, el("span", { class: "ico" }, blockIcon(block.uses)), el("span", {}, block.id)),
					el("div", { class: "sub" }, block.uses),
					el("div", { class: "actions" }, actions));
			}),
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

	if (allTypes.length === 0 || allTypes.every((type) => { return data.entities[type].length === 0; })) {
		return el("div", { class: "panel" }, emptyState(
			"🕸️", "The discovery graph is empty",
			"The graph draws itself as entities and their lineage edges appear. Run a playbook first.",
			{ label: "Go to Playbooks", onClick: () => { ui.view = "playbooks"; } }));
	}

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
	// Scoped to the open playbook (executions carry their playbook id); global on
	// the home level.
	const all = (data.executions || []).filter((e) => { return !ui.openPlaybook || e.playbook === ui.openPlaybook; });

	if (all.length === 0) {
		const book = ui.playbooks.find((p) => { return p.id === ui.openPlaybook; });
		const ranEmpty = book && book.last_run_at;
		const sub = ranEmpty
			? "The last run logged no block executions — the source found nothing to enrich (e.g. CT logs returned no certs for this target). Try another target or run again."
			: "Every block run is logged here — input, output, whether it changed the entity, and timing. Run this playbook to populate it.";

		return el("div", { class: "panel" }, emptyState(
			"📋", ranEmpty ? "This run produced no executions" : "No executions yet", sub,
			ui.served && book ? { label: "▶ run once", onClick: () => { pbRunNow(ui, book); } } : null));
	}

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

// naive flow-name from YAML metadata.name (frontend has no loader).
const nameFromYaml = (yaml) => {
	const match = String(yaml || "").match(/name:\s*["']?([^\s"'#]+)/);

	return match ? match[1] : "imported";
};

// --- Playbook actions (shared by the list and the per-playbook overview) ---

// Deliberate state change (no accidental one-click cycling). Activating starts
// live recon on a schedule, so it confirms via an in-app modal first.
const pbSetState = (ui, book, target) => {
	const apply = () => {
		if (!ui.served) {
			book.state = target;
			ui.frame = ui.frame + 1;
			return;
		}

		// Activating RUNS the playbook immediately (with feedback) instead of
		// waiting up to a full scheduler interval — that's what "active" should feel
		// like. Pausing/drafting is just a state write.
		if (target === "active") {
			ui.running = book.id;
			ui.frame = ui.frame + 1;

			ui.api("POST", "/api/playbooks/" + book.id + "/state", { state: "active" })
				.then(() => { return ui.api("POST", "/api/playbooks/" + book.id + "/run"); })
				.then((res) => {
					const total = (res && res.entities)
						? Object.keys(res.entities).reduce((sum, type) => { return sum + res.entities[type].length; }, 0)
						: 0;
					return ui.refresh({ kind: "ok", msg: "Activated + ran " + book.name + " — " + total + " entities" });
				})
				.catch((error) => {
					ui.running = null;
					ui.toast = { kind: "err", msg: "Activate/run failed: " + error.message };
					ui.frame = ui.frame + 1;
				});
			return;
		}

		ui.api("POST", "/api/playbooks/" + book.id + "/state", { state: target })
			.then(() => { return ui.refresh({ kind: "ok", msg: target + " · " + book.name }); });
	};

	if (target === "active") {
		ui.modal = {
			title: "Activate “" + book.name + "”?",
			message: "It will run on its schedule and perform live reconnaissance against its targets.",
			confirmLabel: "Activate",
			onConfirm: apply
		};
		ui.frame = ui.frame + 1;
		return;
	}

	apply();
};

// Run once — a LIVE convergence that can take a while (or find nothing). Shows a
// running state on the button and a result toast, so it's never "nothing".
const pbRunNow = (ui, book) => {
	if (!ui.served) {
		ui.toast = { kind: "err", msg: "Run needs the served app (yarn web)." };
		ui.frame = ui.frame + 1;
		return;
	}

	ui.running = book.id;
	ui.frame = ui.frame + 1;

	ui.api("POST", "/api/playbooks/" + book.id + "/run").then((res) => {
		if (res && res.error) {
			ui.running = null;
			ui.toast = { kind: "err", msg: "Run failed: " + res.error };
			ui.frame = ui.frame + 1;
			return;
		}

		const total = (res && res.entities)
			? Object.keys(res.entities).reduce((sum, type) => { return sum + res.entities[type].length; }, 0)
			: 0;

		ui.refresh({ kind: "ok", msg: "Ran " + book.name + " — " + total + " entities" });
	}).catch((error) => {
		ui.running = null;
		ui.toast = { kind: "err", msg: "Run failed: " + error.message };
		ui.frame = ui.frame + 1;
	});
};

// In-app modal — either a confirmation (message + Cancel/Confirm) or a content
// dialog (e.g. the per-block editor) with a Done button.
const modalEl = (ui, modal) => {
	const close = () => { ui.modal = null; ui.frame = ui.frame + 1; };

	if (modal.content) {
		const head = [el("h3", {}, (modal.ico ? modal.ico + " " : "") + modal.title)];
		if (modal.describe) { head.push(el("p", {}, modal.describe)); }

		return el("div", { class: "modal-backdrop", onclick: close },
			el("div", { class: "modal wide", onclick: (e) => { e.stopPropagation(); } },
				el("div", {}, head),
				modal.content,
				el("div", { class: "modal-actions" }, el("button", { class: "btn btn-accent", onclick: close }, "Done"))));
	}

	return el("div", { class: "modal-backdrop", onclick: close },
		el("div", { class: "modal", onclick: (e) => { e.stopPropagation(); } },
			el("h3", {}, modal.title),
			el("p", {}, modal.message),
			el("div", { class: "modal-actions" },
				el("button", { class: "btn", onclick: close }, "Cancel"),
				el("button", { class: "btn btn-accent", onclick: () => { close(); modal.onConfirm(); } },
					modal.confirmLabel || "Confirm"))));
};

const pbActivateAttrs = (ui, book, stop) => {
	const attrs = {
		class: "btn btn-ghost", title: "schedule + run this playbook",
		onclick: (e) => { if (stop) { e.stopPropagation(); } pbSetState(ui, book, "active"); }
	};

	if (book.valid === false) {
		attrs.disabled = true;
		attrs.title = "fix validation errors before activating";
	}

	return attrs;
};

// The activate/pause + run-once action buttons for a playbook. `stop` guards the
// clicks from bubbling to a card's open-on-click.
const pbActionButtons = (ui, book, stop) => {
	const guard = (fn) => { return (e) => { if (stop) { e.stopPropagation(); } fn(); }; };

	return [
		(book.state === "active")
			? el("button", { class: "btn btn-ghost", title: "stop scheduling",
				onclick: guard(() => { pbSetState(ui, book, "paused"); }) }, "⏸ pause")
			: el("button", pbActivateAttrs(ui, book, stop), "⚡ activate"),
		ui.served
			? el("button", {
				class: () => (ui.running === book.id ? "btn btn-accent running" : "btn btn-accent"),
				title: "converge once now",
				onclick: guard(() => { pbRunNow(ui, book); })
			}, () => (ui.running === book.id ? "⟳ running…" : "▶ run once"))
			: el("span", {})
	];
};

// Import controls (sample gallery + paste box) — the "new playbook" affordances,
// shared by the empty state and the list footer.
const importControls = (data, ui) => {
	const addDraft = (name, yaml, schedule) => {
		if (ui.served) {
			ui.api("POST", "/api/playbooks/import", { name: name, schedule: schedule || null, yaml: yaml })
				.then(() => { ui.pbImportText = ""; return ui.refresh(); });
			return;
		}

		ui.playbooks.push({
			id: "pb-" + (ui.playbooks.length + 1), name: name, state: "draft",
			schedule: schedule || null, valid: true, yaml: yaml, last_run_at: null
		});
		ui.pbImportText = "";
		ui.frame = ui.frame + 1;
	};

	const samplesEl = el("div", { class: "chips" }, (data.samples || []).map((sample) => {
		return el("button", { class: "chip", title: sample.description || sample.name,
			onclick: () => { addDraft(sample.name, sample.yaml, null); } }, "＋ " + sample.name);
	}));

	const importBox = el("textarea", {
		class: "in", placeholder: "paste a playbook artifact (JSON) or a flow YAML…",
		oninput: (e) => { ui.pbImportText = e.target.value; }
	});

	const importBtn = el("button", { class: "btn", onclick: () => {
		const text = String(ui.pbImportText || "").trim();
		if (!text) { return; }

		try {
			const parsed = JSON.parse(text);
			addDraft(parsed.name || nameFromYaml(parsed.yaml || ""), parsed.yaml || "", parsed.schedule || null);
		} catch {
			addDraft(nameFromYaml(text), text, null);
		}
	} }, "⇧ import as draft");

	return el("div", {},
		el("h3", {}, "start from a sample"),
		(data.samples && data.samples.length > 0) ? samplesEl : el("p", { class: "muted" }, "no samples bundled"),
		el("h3", {}, "or import a flow"),
		el("div", { class: "editor" }, importBox, importBtn));
};

// TOP LEVEL: the list of all playbooks. A card OPENS its workspace.
const playbooksView = (data, ui) => {
	// Reactive card grid via qrp's list() — cards are DIRECT grid children (the
	// old el("g",…) wrapper collapsed the grid in real browsers).
	const cardOf = (book) => {
		return el("div", {
			class: "pbcard",
			title: "open " + book.name,
			onclick: () => { ui.openBook(book.id); }
		},
		el("div", { class: "top" },
			el("div", { class: "nm" }, book.name),
			el("span", { class: "pill pill-pb-" + book.state }, book.state)),
		el("div", { class: "meta" },
			el("span", {}, book.valid === false ? "✗ invalid" : "✓ valid"),
			el("span", {}, book.schedule || "no schedule"),
			el("span", {}, book.last_run_at ? ("ran " + String(book.last_run_at).slice(0, 10)) : "never run")),
		el("div", { class: "actions" }, pbActionButtons(ui, book, true).concat([
			el("button", { class: "btn btn-ghost", title: "open workspace",
				onclick: (e) => { e.stopPropagation(); ui.openBook(book.id); } }, "open →")
		])));
	};

	const cards = el("div", { class: "pbgrid" },
		list(() => { ui.frame; return ui.playbooks; }, (book) => book.id, cardOf));

	if (ui.playbooks.length === 0) {
		return el("div", { class: "panel" },
			emptyState("📚", "No playbooks yet",
				"A playbook is a saved flow with a draft → active → paused lifecycle. Start from a sample below, or paste one to import."),
			importControls(data, ui));
	}

	return el("div", { class: "panel" },
		el("div", { class: "hint" }, "your saved flows — click one to open its workspace (overview · entities · graph · executions · flow)"),
		cards,
		importControls(data, ui));
};

// SECOND LEVEL: one playbook's overview (its config + run summary).
const playbookOverview = (data, ui) => {
	const book = ui.playbooks.find((b) => { return b.id === ui.openPlaybook; });

	if (!book) {
		return el("div", { class: "panel" }, emptyState("🗂️", "Playbook not found",
			"It may have been removed.", { label: "Back to Playbooks", onClick: () => { ui.closeBook(); } }));
	}

	const execs = (data.executions || []).filter((e) => { return e.playbook === book.id; });
	const changed = execs.filter((e) => { return e.status === "ok" && e.changed; }).length;
	const lastRun = book.last_run_at ? String(book.last_run_at).slice(0, 19).replace("T", " ") : "never";

	const tile = (k, v, cls) => {
		return el("div", { class: "m" }, el("div", { class: "k" }, k), el("div", { class: "v " + (cls || "") }, v));
	};

	const parts = [
		el("div", { class: "pb-head" },
			el("div", { class: "pb-title" },
				el("span", { class: "pb-name" }, book.name),
				el("span", { class: "pill pill-pb-" + book.state }, book.state)),
			el("div", { class: "actions" }, pbActionButtons(ui, book, false))),
		el("div", { class: "pb-meta" },
			tile("valid", book.valid === false ? "✗ no" : "✓ yes", book.valid === false ? "warn" : "good"),
			tile("schedule", book.schedule || "none"),
			tile("last run", lastRun),
			tile("executions", String(execs.length)),
			tile("changed", String(changed)))
	];

	if (book.valid === false && book.errors && book.errors.length > 0) {
		parts.push(el("h3", {}, "validation errors"));
		parts.push(el("ul", { class: "err-pre" }, book.errors.map((e) => { return el("li", {}, e); })));
	}

	parts.push(el("div", { class: "actions" },
		el("button", { class: "btn btn-ghost", onclick: () => {
			ui.pbExport = ui.pbExport ? null : JSON.stringify(
				{ convergencePlaybook: 1, name: book.name, schedule: book.schedule, yaml: book.yaml }, null, 2);
			ui.frame = ui.frame + 1;
		} }, "⇩ export artifact")));

	if (ui.pbExport) {
		parts.push(el("pre", {}, ui.pbExport));
	}

	parts.push(el("h3", {}, "flow yaml"));
	parts.push(el("pre", { class: "yaml scroll" }, book.yaml || "(empty)"));

	return el("div", { class: "panel" }, el("div", {}, parts));
};

// --- Shell ----------------------------------------------------------------

// Derive the view + open playbook from the URL path (deep-link / back-forward).
//   /                     -> playbooks list (home)
//   /pb/<id>              -> that playbook's overview
//   /pb/<id>/<section>    -> that playbook, that section
const parseLocation = () => {
	const path = (typeof window !== "undefined" && window.location && window.location.pathname) || "/";
	const match = path.match(/^\/pb\/([^/]+)(?:\/([^/]+))?/);

	if (match) { return { openPlaybook: decodeURIComponent(match[1]), view: match[2] || "overview" }; }

	return { openPlaybook: null, view: "playbooks" };
};

export const render = (root, data) => {
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

	// The URL is the source of truth for where we are (deep-link + back/forward);
	// a re-render re-derives it, so state survives refreshes.
	const loc = parseLocation();

	// The Flow builder edits the OPEN playbook's flow (parsed from its YAML), so
	// Save writes back to the right playbook; falls back to the snapshot spec.
	const openBook = loc.openPlaybook ? seedPlaybooks.find((b) => { return b.id === loc.openPlaybook; }) : null;
	let flowSpec = data.spec || { entities: {}, sources: [], blocks: [] };
	if (openBook && openBook.yaml) {
		try { flowSpec = loadYamlLib(openBook.yaml) || flowSpec; } catch { /* keep fallback */ }
	}
	const graph = computeGraph(flowSpec);

	const ui = state({
		view: loc.view,
		openPlaybook: loc.openPlaybook,
		served: Boolean(data.__served),
		playbooks: seedPlaybooks,
		modal: null,
		toast: data.__toast || null,
		running: null,
		pbSel: data.__pbSel || null,
		pbExport: null,
		pbImportText: "",
		type: entityTypes.indexOf("host") !== -1 ? "host" : entityTypes[0],
		query: "",
		selected: null,
		exploreMode: "tree",
		expanded: {},
		block: null,
		topo: 0,
		palQuery: "",
		graph: graph,
		pos: builderLayout(graph, narrow),
		spec: flowSpec,
		dirty: false,
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

	ui.refresh = (toast) => {
		return fetch("/api/snapshot")
			.then((response) => { return response.json(); })
			.then((fresh) => {
				fresh.__served = true;
				// Preserve where the user was (view + open playbook) across the
				// re-render, so an action doesn't bounce them elsewhere.
				fresh.__view = ui.view;
				fresh.__openPlaybook = ui.openPlaybook;
				fresh.__pbSel = ui.pbSel;
				if (toast) { fresh.__toast = toast; }
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

	const views = {
		playbooks: () => playbooksView(data, ui),
		overview: () => playbookOverview(data, ui),
		explorer: () => explorer(data, ui),
		graph: () => graphView(data, ui),
		executions: () => executionsView(data, ui),
		builder: () => builder(data, ui)
	};

	const SECTIONS = {
		playbooks: { title: "Playbooks", sub: "all saved flows", ico: "▤" },
		overview: { title: "Overview", sub: "this playbook's config + run summary", ico: "◎" },
		explorer: { title: "Entities", sub: "discovered entities (global store)", ico: "▦" },
		graph: { title: "Graph", sub: "discovery graph (global store)", ico: "◈" },
		executions: { title: "Executions", sub: "this playbook's block runs", ico: "≡" },
		builder: { title: "Flow", sub: "the flow as a node graph", ico: "⚙" }
	};

	// Navigation is URL-driven: go() sets the reactive state (so the shell updates
	// with no full re-render) AND pushes the URL via the qrp router when available
	// (back/forward + deep-link + shareable links). On a static export (no
	// history) it just updates state.
	ui.go = (url, view, openPlaybook) => {
		// With the router live, drive everything through the URL (the route handler
		// sets the state) so back/forward and deep-links stay consistent. Without
		// it (static export / tests), set the reactive state directly.
		if (root.__router) {
			try { navigate(url); return; } catch { /* fall through to direct */ }
		}

		ui.openPlaybook = openPlaybook;
		ui.view = view;
		ui.frame = ui.frame + 1;
	};
	ui.openBook = (id) => { ui.go("/pb/" + id + "/overview", "overview", id); };
	ui.closeBook = () => { ui.go("/", "playbooks", null); };

	// A data-view sub-nav item (only meaningful inside an open playbook).
	const navItem = (id, label) => {
		return el("button", {
			class: () => (ui.view === id ? "nav-item active" : "nav-item"),
			onclick: () => { ui.go("/pb/" + ui.openPlaybook + "/" + id, id, ui.openPlaybook); }
		}, el("span", { class: "ico" }, SECTIONS[id].ico), el("span", {}, label));
	};

	const homeNav = () => {
		return el("div", { class: "nav-group" },
			el("div", { class: "nav-label" }, "home"),
			el("button", { class: "nav-item active", onclick: () => { ui.go("/", "playbooks", null); } },
				el("span", { class: "ico" }, "▤"), el("span", {}, "Playbooks"),
				el("span", { class: "badge-n" }, String(ui.playbooks.length))));
	};

	const pbNav = (id) => {
		const openName = (ui.playbooks.find((b) => { return b.id === id; }) || { name: "playbook" }).name;

		return el("div", {},
			el("button", { class: "nav-item", title: "back to all playbooks", onclick: () => { ui.closeBook(); } },
				el("span", { class: "ico" }, "←"), el("span", {}, "All playbooks")),
			el("div", { class: "nav-group" },
				el("div", { class: "nav-label" }, openName),
				navItem("overview", "Overview"),
				navItem("explorer", "Entities"),
				navItem("graph", "Graph"),
				navItem("executions", "Executions"),
				navItem("builder", "Flow")));
	};

	const foot = el("div", { class: "sidebar-foot" },
		el("span", { class: "dot " + (ui.served ? "live" : "snap") }),
		ui.served ? "live · connected" : "static snapshot");

	// Two-level rail — reactive on the open playbook, so navigating swaps the nav
	// level without a full re-render.
	const sidebar = el("aside", { class: "sidebar" },
		el("div", { class: "brand" }, "convergence"),
		when(() => (ui.openPlaybook ? "pb:" + ui.openPlaybook : "home"), (key) => (key === "home" ? homeNav() : pbNav(ui.openPlaybook))),
		foot);

	const topbar = el("div", { class: "topbar" }, () => {
		ui.frame;
		const meta = SECTIONS[ui.view] || { title: "", sub: "" };
		const crumb = ui.openPlaybook
			? ((ui.playbooks.find((b) => { return b.id === ui.openPlaybook; }) || { name: "" }).name + " / " + meta.title)
			: "Playbooks";

		return el("div", { style: "display:flex;flex-direction:column;gap:2px" },
			el("div", { class: "section-title" }, crumb),
			el("div", { class: "section-sub" }, meta.sub));
	}, statBar(data, ui));

	const main = el("main", { class: "main" }, topbar,
		el("div", {}, when(() => ui.view, (view) => (views[view] || views.playbooks)())));

	// Overlay: modal keyed on its IDENTITY (so editing inside it doesn't rebuild
	// and drop input focus); toast is frame-reactive (set/cleared transiently).
	const overlay = el("div", {},
		when(() => (ui.modal ? (ui.modal.key || "modal") : "none"), (k) => (k === "none" ? el("span", {}) : modalEl(ui, ui.modal))),
		el("div", {}, () => { ui.frame; return ui.toast ? el("div", { class: "toast " + (ui.toast.kind || "") }, ui.toast.msg) : el("span", {}); }));

	const app = el("div", { class: "shell" }, sidebar, main, overlay);

	root.appendChild(app);

	// URL routing (back/forward, deep-link, shareable links) via the qrp router.
	// Handlers set the reactive state; nav uses ui.go() to push URLs. Disposed +
	// reinstalled on each render; degrades gracefully where history is absent.
	if (typeof window !== "undefined" && window.history && window.history.pushState && !window.__NO_ROUTER__) {
		if (root.__router) { try { root.__router.dispose(); } catch { /* noop */ } }

		const home = () => { ui.openPlaybook = null; ui.view = "playbooks"; ui.frame = ui.frame + 1; };

		try {
			root.__router = router({
				"/": home,
				"/pb/:id": (outlet, ctx) => { navigate("/pb/" + ctx.params.id + "/overview", { replace: true }); },
				"/pb/:id/:section": (outlet, ctx) => { ui.openPlaybook = ctx.params.id; ui.view = ctx.params.section; ui.frame = ui.frame + 1; }
			}, document.createElement("div"), { remount: true, notFound: home });
		} catch { root.__router = null; }
	}

	// Live data: poll a cheap revision; when server state changes (a scheduled run
	// finished, another client mutated), reload — unless the user is mid-action.
	if (ui.served && typeof setInterval !== "undefined") {
		if (root.__poll) { clearInterval(root.__poll); }

		root.__poll = setInterval(() => {
			fetch("/api/health").then((r) => { return r.json(); }).then((h) => {
				if (root.__lastRev === undefined) { root.__lastRev = h.rev; return; }
				if (h.rev !== root.__lastRev && !ui.modal && !ui.drag && !ui.running && !ui.dirty) {
					root.__lastRev = h.rev;
					ui.refresh();
				}
			}).catch(() => { /* offline; try next tick */ });
		}, 5000);
	}

	// Auto-dismiss a toast after a few seconds.
	if (ui.toast && typeof setTimeout !== "undefined") {
		setTimeout(() => { ui.toast = null; ui.frame = ui.frame + 1; }, 4500);
	}

	return app;
};
