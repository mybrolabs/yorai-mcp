#!/usr/bin/env node
// Local mode: Claude Desktop / Claude Code launch this over stdio.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
const server = buildServer();
await server.connect(new StdioServerTransport());
console.error("yorai-mcp running on stdio");
