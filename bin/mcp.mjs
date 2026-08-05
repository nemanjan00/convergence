// convergence MCP server (stdio) — gives an AI parity access to the platform:
// list the block library, validate a flow, run it, and query entities in the
// sift dialect. Thin glue over src/mcp. See docs + the Trickest SDK for the
// shape this mirrors.
//
// Run: yarn mcp   (or point an MCP client at: node bin/mcp.mjs)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const mcp = require("../src/mcp");

const asText = (value) => {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
};

const server = new McpServer({ name: "convergence", version: "0.0.1" });

server.registerTool("list_blocks", {
	title: "List blocks",
	description: "List the available blocks (the tool library) and sources a flow may use.",
	inputSchema: {}
}, async () => {
	return asText(mcp.listBlocks());
});

server.registerTool("validate_flow", {
	title: "Validate flow",
	description: "Validate a flow YAML against the contract; returns { valid, errors }.",
	inputSchema: { yaml: z.string() }
}, async (args) => {
	return asText(mcp.validateFlow(args.yaml));
});

server.registerTool("run_flow", {
	title: "Run flow",
	description: "Run a flow YAML to convergence (live). Returns entities (as rows) and lineage edges.",
	inputSchema: { yaml: z.string() }
}, async (args) => {
	return mcp.runFlow(args.yaml).then(asText);
});

server.registerTool("query_entities", {
	title: "Query entities",
	description: "Query entities from the last run with a Mongo-style (sift) filter. Returns { columns, rows, row_count }.",
	inputSchema: {
		entityType: z.string(),
		query: z.record(z.any()).optional(),
		select: z.array(z.string()).optional(),
		limit: z.number().optional()
	}
}, async (args) => {
	return asText(mcp.queryEntities(args));
});

server.registerTool("list_playbooks", {
	title: "List playbooks",
	description: "List playbooks and their lifecycle state (draft/active/paused).",
	inputSchema: {}
}, async () => {
	return asText(mcp.listPlaybooks());
});

server.registerTool("get_playbook", {
	title: "Get playbook",
	description: "Get one playbook in full (YAML + validation errors) by id.",
	inputSchema: { id: z.string() }
}, async (args) => {
	return asText(mcp.getPlaybook(args.id));
});

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
	return asText(mcp.savePlaybook(args));
});

server.registerTool("set_playbook_state", {
	title: "Set playbook state",
	description: "Transition a playbook to draft | active | paused (activating an invalid playbook is refused).",
	inputSchema: { id: z.string(), state: z.enum(["draft", "active", "paused"]) }
}, async (args) => {
	return asText(mcp.setPlaybookState(args.id, args.state));
});

server.registerTool("export_playbook", {
	title: "Export playbook",
	description: "Export a playbook as a portable artifact { name, schedule, yaml } for sharing/committing.",
	inputSchema: { id: z.string() }
}, async (args) => {
	return asText(mcp.exportPlaybook(args.id));
});

server.registerTool("import_playbook", {
	title: "Import playbook",
	description: "Import a portable playbook artifact (or a bare flow YAML string) as a new draft.",
	inputSchema: { name: z.string().optional(), schedule: z.string().optional(), yaml: z.string() }
}, async (args) => {
	return asText(mcp.importPlaybook(args));
});

server.connect(new StdioServerTransport());
