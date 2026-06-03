#!/usr/bin/env node
// GitHub Claw — MCP server. Exposes the search pipeline as a Model Context
// Protocol tool so coding agents get GROUNDED, hallucination-free repo
// discovery: every result is a real, currently-live GitHub repo with a
// transparent score and an Adopt/Risky/Abandoned maintenance verdict — the
// thing an LLM guessing repo names structurally can't guarantee.
//
//   npm run mcp        # stdio transport
//
// NB: in stdio MCP the protocol owns stdout — all logging MUST go to stderr.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runSearchPipeline } from "../lib/searchPipeline";
import type { RankedRepo } from "../lib/types";

const TOOL_NAME = "search_repositories";

const server = new Server(
  { name: "github-claw", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_NAME,
      description:
        "Find REAL, currently-live GitHub repositories matching a plain-English idea " +
        "(e.g. 'self-hosted Typeform alternative in React'). Returns ranked repos pulled " +
        "from the GitHub API — never invented — each with a 0-100 match score and an " +
        "Adopt/Risky/Abandoned maintenance verdict derived from live metadata. Use this " +
        "instead of guessing repository names.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Plain-English description of the tool/library/project to find.",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10, max 50).",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== TOOL_NAME) {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  const args = (req.params.arguments ?? {}) as { query?: unknown; limit?: unknown };
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return {
      isError: true,
      content: [{ type: "text", text: "Error: 'query' is required." }],
    };
  }
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));

  const res = await runSearchPipeline(query, {
    token: process.env.GITHUB_TOKEN || undefined,
  });
  const results = res.results.slice(0, limit).map(slim);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { query: res.query, expandedQueries: res.expandedQueries, results },
          null,
          2,
        ),
      },
    ],
  };
});

// A compact, agent-friendly projection of each result.
function slim(r: RankedRepo) {
  return {
    fullName: r.fullName,
    url: r.url,
    description: r.description,
    score: r.score,
    verdict: r.maintenance.verdict,
    verdictReasons: r.maintenance.reasons,
    stars: r.stars,
    language: r.language,
    license: r.license,
    topics: r.topics,
    pushedAt: r.pushedAt,
    archived: r.archived,
    fork: r.fork,
    whyMatched: r.whyMatched,
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-claw MCP server ready (stdio).");
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exitCode = 1;
});
