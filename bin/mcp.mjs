// convergence MCP server (stdio) — the AI-facing surface. It is a THIN HTTP
// CLIENT of the running convergence app (src/index.js, `yarn web`): every tool
// maps to an /api/* route, so the AI and the human UI drive the SAME stateful
// process (shared store / journal / playbook registry). Point it at a non-default
// app with CONVERGENCE_URL.
//
// Run the app first (`yarn web`), then: yarn mcp   (or point an MCP client here).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.CONVERGENCE_URL || "http://localhost:3000").replace(/\/$/, "");

// Call the app's REST API. Returns parsed JSON, or an { error } object so a tool
// never throws into the transport (e.g. when the app isn't running).
const api = (method, apiPath, body) => {
	return fetch(BASE + apiPath, {
		method: method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body)
	}).then((response) => {
		return response.text().then((text) => {
			try {
				return JSON.parse(text);
			} catch {
				return { error: "non-JSON response (" + response.status + ")", body: text.slice(0, 200) };
			}
		});
	}).catch((error) => {
		return { error: "cannot reach convergence app at " + BASE + " — is `yarn web` running? (" + error.message + ")" };
	});
};

const asText = (value) => {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
};

const server = new McpServer({ name: "convergence", version: "0.1.0" });

server.registerTool("list_blocks", {
	title: "List blocks",
	description: "List the available blocks (the tool library) and sources a flow may use.",
	inputSchema: {}
}, async () => { return asText(await api("GET", "/api/blocks")); });

server.registerTool("validate_flow", {
	title: "Validate flow",
	description: "Validate a flow YAML against the contract; returns { valid, errors }.",
	inputSchema: { yaml: z.string() }
}, async (args) => { return asText(await api("POST", "/api/flows/validate", { yaml: args.yaml })); });

server.registerTool("run_flow", {
	title: "Run flow",
	description: "Run a flow YAML to convergence (live). Returns entities (as rows) and lineage edges.",
	inputSchema: { yaml: z.string() }
}, async (args) => { return asText(await api("POST", "/api/flows/run", { yaml: args.yaml })); });

server.registerTool("query_entities", {
	title: "Query entities",
	description: "Query entities from the app's store with a Mongo-style (sift) filter. Returns { columns, rows, row_count }.",
	inputSchema: {
		entityType: z.string(),
		query: z.record(z.any()).optional(),
		select: z.array(z.string()).optional(),
		limit: z.number().optional()
	}
}, async (args) => { return asText(await api("POST", "/api/entities/query", args)); });

server.registerTool("list_playbooks", {
	title: "List playbooks",
	description: "List playbooks and their lifecycle state (draft/active/paused).",
	inputSchema: {}
}, async () => { return asText(await api("GET", "/api/playbooks")); });

server.registerTool("get_playbook", {
	title: "Get playbook",
	description: "Get one playbook in full (YAML + validation errors) by id.",
	inputSchema: { id: z.string() }
}, async (args) => { return asText(await api("GET", "/api/playbooks/" + encodeURIComponent(args.id))); });

server.registerTool("save_playbook", {
	title: "Save playbook",
	description: "Create a new playbook (omit id) or update an existing one (with id). Returns { valid, errors }.",
	inputSchema: {
		id: z.string().optional(),
		name: z.string().optional(),
		yaml: z.string().optional(),
		schedule: z.string().optional()
	}
}, async (args) => {
	if (args.id) {
		return asText(await api("PUT", "/api/playbooks/" + encodeURIComponent(args.id), args));
	}

	return asText(await api("POST", "/api/playbooks", args));
});

server.registerTool("set_playbook_state", {
	title: "Set playbook state",
	description: "Transition a playbook to draft | active | paused (activating an invalid playbook is refused).",
	inputSchema: { id: z.string(), state: z.enum(["draft", "active", "paused"]) }
}, async (args) => {
	return asText(await api("POST", "/api/playbooks/" + encodeURIComponent(args.id) + "/state", { state: args.state }));
});

server.registerTool("export_playbook", {
	title: "Export playbook",
	description: "Export a playbook as a portable artifact { name, schedule, yaml }.",
	inputSchema: { id: z.string() }
}, async (args) => { return asText(await api("GET", "/api/playbooks/" + encodeURIComponent(args.id) + "/export")); });

server.registerTool("import_playbook", {
	title: "Import playbook",
	description: "Import a portable playbook artifact (or a bare flow YAML string) as a new draft.",
	inputSchema: { name: z.string().optional(), schedule: z.string().optional(), yaml: z.string() }
}, async (args) => { return asText(await api("POST", "/api/playbooks/import", args)); });

server.connect(new StdioServerTransport());
