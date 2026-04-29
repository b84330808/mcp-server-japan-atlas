#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

import { normalizeJpAddress, AddressNormalizationError } from "./address.js";
import { getGsiElevation, ElevationError } from "./elevation.js";

const SERVER_NAME = "mcp-server-japan-atlas";
const SERVER_VERSION = "1.0.0";

const TOOL_NORMALIZE_ADDRESS = "normalize_jp_address";
const TOOL_GSI_ELEVATION = "get_gsi_geo_context";

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool Registry ────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_NORMALIZE_ADDRESS,
      description:
        "Normalizes a raw or messy Japanese address string into structured components " +
        "(prefecture, city, ward, block) and attempts to resolve approximate latitude/longitude " +
        "via the Japan GSI Address Search API (msearch.gsi.go.jp). No API key required. " +
        "Use this tool whenever a user provides a Japanese address that needs to be parsed, " +
        "geocoded, or validated.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description:
              "The Japanese address to normalize. Can be written in kanji, hiragana, or a mix. " +
              "Examples: '東京都渋谷区道玄坂1-2-3', '〒150-0043 東京都渋谷区道玄坂', " +
              "'大阪市北区梅田１丁目１３番地'.",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_GSI_ELEVATION,
      description:
        "Returns the elevation (in metres above sea level) for a given latitude/longitude " +
        "within Japan, using the official Japan Geospatial Information Authority (GSI) DEM API. " +
        "No API key required. Also returns the data source identifier (hsrc) for provenance. " +
        "Coverage is limited to Japanese territory. " +
        "Pair this with 'normalize_jp_address' to build a complete geospatial profile of any Japanese location.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: {
            type: "number",
            description:
              "WGS84 decimal latitude. Must be within Japan's coverage area (approx. 20.4 – 45.6).",
          },
          longitude: {
            type: "number",
            description:
              "WGS84 decimal longitude. Must be within Japan's coverage area (approx. 122.9 – 153.0).",
          },
        },
        required: ["latitude", "longitude"],
        additionalProperties: false,
      },
    },
  ],
}));

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args || typeof args !== "object") {
    throw new McpError(ErrorCode.InvalidParams, "Tool arguments must be a non-null object.");
  }

  switch (name) {
    case TOOL_NORMALIZE_ADDRESS: {
      const address = (args as Record<string, unknown>)["address"];
      if (typeof address !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "'address' must be a string.");
      }

      try {
        const result = await normalizeJpAddress(address);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  data: result,
                  note:
                    result.latitude !== null
                      ? "Geocoordinates resolved. Use get_gsi_geo_context to enrich with elevation."
                      : "Geocoordinates could not be resolved for this address. Structured fields are derived from local parsing.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof AddressNormalizationError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: false, error: err.payload }, null, 2),
              },
            ],
            isError: true,
          };
        }
        throw new McpError(ErrorCode.InternalError, `Unexpected error: ${String(err)}`);
      }
    }

    case TOOL_GSI_ELEVATION: {
      const rawArgs = args as Record<string, unknown>;
      const lat = rawArgs["latitude"];
      const lon = rawArgs["longitude"];

      if (typeof lat !== "number" || typeof lon !== "number") {
        throw new McpError(ErrorCode.InvalidParams, "'latitude' and 'longitude' must be numbers.");
      }

      try {
        const result = await getGsiElevation(lat, lon);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  data: result,
                  note:
                    result.elevation === null
                      ? "Elevation could not be determined for this location (e.g., open sea or data gap in GSI DEM)."
                      : `Elevation is ${result.elevation} m above sea level. Data source: ${result.hsrc}.`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof ElevationError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: false, error: err.payload }, null, 2),
              },
            ],
            isError: true,
          };
        }
        throw new McpError(ErrorCode.InternalError, `Unexpected error: ${String(err)}`);
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: "${name}"`);
  }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is reserved for MCP JSON-RPC messages
  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
