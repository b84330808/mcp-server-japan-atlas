# 🗾 mcp-server-japan-atlas

> **An MCP server that gives Claude a deep understanding of Japanese geography** — normalizing addresses, resolving coordinates, and querying official GSI elevation data, all without requiring any API keys.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-26%20passing-success)](#)

---

## Why This Exists

Japanese addresses are famously difficult for software systems — and even more so for AI models.

**The core problems:**

| Problem | Example |
|---|---|
| Non-Western ordering (large → small) | Prefecture → City → Ward → Block → Building |
| Multiple valid representations | `1-2-3` vs `１丁目２番３号` vs `一丁目二番地三号` |
| No standardized delimiter | Spaces, commas, newlines, or nothing at all |
| Kanji ambiguity | 市 (city) vs 区 (ward) vs 町 (town) vs 村 (village) |
| Postal codes intermixed | `〒150-0043 東京都渋谷区道玄坂1-2-3` |

When a user tells Claude *"find me restaurants near 渋谷区道玄坂1-2-3"*, Claude cannot natively resolve that to coordinates, validate the address is real, or understand its elevation context (e.g., for flood-risk queries).

**mcp-server-japan-atlas bridges this gap** by connecting Claude directly to official Japanese public APIs — turning unstructured Japanese address text into precise, structured geospatial data in real time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Claude (LLM)                         │
│              "What's near 東京都渋谷区道玄坂1?"              │
└───────────────────────┬─────────────────────────────────────┘
                        │ MCP Protocol (stdio JSON-RPC)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              mcp-server-japan-atlas (this server)           │
│                                                             │
│  Tool: normalize_jp_address          Tool: get_gsi_geo_context │
│  ┌──────────────────────┐            ┌──────────────────────┐ │
│  │  1. Input validation │            │  1. Coord validation │ │
│  │  2. Regex parse      │            │  2. Japan bounds check│ │
│  │  3. HeartRails API → │            │  3. GSI DEM API call │ │
│  │     lat/lon/postal   │            │  4. Elevation + hsrc │ │
│  └──────────────────────┘            └──────────────────────┘ │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
           ▼                                  ▼
  HeartRails Express API            Japan GSI Elevation API
  (express.heartrails.com)          (cyberjapandata2.gsi.go.jp)
  No key required                   No key required
  Japan Post address DB             Official DEM, 5m/10m resolution
```

---

## Tools

### `normalize_jp_address`

Parses a raw Japanese address string into structured components and attempts geocoding.

**Input:**
```json
{
  "address": "〒150-0043 東京都渋谷区道玄坂1-2-3"
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "original": "〒150-0043 東京都渋谷区道玄坂1-2-3",
    "prefecture": "東京都",
    "city": "渋谷区",
    "ward": "",
    "block": "1-2-3",
    "remainder": "道玄坂",
    "latitude": 35.6591,
    "longitude": 139.6981,
    "source": "heartrails-express"
  },
  "note": "Geocoordinates resolved. Use get_gsi_geo_context to enrich with elevation."
}
```

**Error handling:** Returns structured error objects with codes `INVALID_INPUT`, `ADDRESS_NOT_FOUND` — never throws raw stack traces to the LLM.

---

### `get_gsi_geo_context`

Returns the official elevation at any point in Japan using the GSI (国土地理院) Digital Elevation Model API.

**Input:**
```json
{
  "latitude": 35.6591,
  "longitude": 139.6981
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "latitude": 35.6591,
    "longitude": 139.6981,
    "elevation": 37.5,
    "unit": "metres",
    "hsrc": "5m"
  },
  "note": "Elevation is 37.5 m above sea level. Data source: 5m."
}
```

**Data source codes (`hsrc`):** `5m` = 5m-resolution DEM, `10m` = 10m-resolution DEM, `none` = sea/no data.

---

## Installation

### Prerequisites

- Node.js 18 or higher
- Claude Desktop (or any MCP-compatible client)

### Install from source

```bash
git clone https://github.com/your-username/mcp-server-japan-atlas
cd mcp-server-japan-atlas
npm install
npm run build
```

### Verify it works

```bash
# Should print: mcp-server-japan-atlas v1.0.0 running on stdio
node dist/index.js
```

Press `Ctrl+C` to exit.

---

## Claude Desktop Configuration

Add the following to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "japan-atlas": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-japan-atlas/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/mcp-server-japan-atlas` with the actual path where you cloned the repo.

**Windows example:**
```json
{
  "mcpServers": {
    "japan-atlas": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\projects\\mcp-server-japan-atlas\\dist\\index.js"]
    }
  }
}
```

Restart Claude Desktop after saving. To verify the server loaded:

1. Click the **`+`** button in the bottom-left of the chat input area
2. Select **Connectors**
3. You should see **`japan-atlas`** listed with a blue toggle (enabled)

If the toggle is grey, click it to enable. No hammer icon — the server lives in the Connectors menu.

---

## Example Prompts

Once installed, try these prompts in Claude Desktop:

**Address normalization:**
> "Parse this address for me: 東京都渋谷区道玄坂1-2-3"

> "I have a Japanese address written messily: 〒150-0043 東京都 渋谷区 道玄坂 1丁目2番3号. Can you give me the structured components and coordinates?"

> "Is this a valid Japanese address? 大阪府大阪市北区梅田１丁目１３番地"

**Elevation & geospatial context:**
> "What is the elevation at the coordinates of Shibuya Station (35.6580, 139.7016)?"

> "I'm looking at a building at lat 35.3607, lon 138.7274 — what's the elevation? Is this likely to be near Mount Fuji?"

**Chained workflow:**
> "Normalize the address 京都府京都市中京区河原町通 and then tell me the elevation at those coordinates."

> "I'm building a flood-risk report for 横浜市西区みなとみらい2丁目. What are the structured address components and how high above sea level is this area?"

**Error handling demonstration:**
> "What happens if I give you a fake address like あいうえおかきくけこ?"

> "Try to get the elevation of London, UK using the Japan GSI tool."

---

## Development

```bash
# Type-check without building
npm run lint

# Run tests
npm test

# Run tests with coverage report
npm run test:coverage

# Build for production
npm run build
```

### Project Structure

```
mcp-server-japan-atlas/
├── src/
│   ├── index.ts        # MCP server, tool registry & dispatch
│   ├── address.ts      # Address normalization logic + HeartRails API
│   ├── elevation.ts    # GSI elevation API client
│   └── types.ts        # Shared TypeScript interfaces
├── tests/
│   └── index.test.ts   # 26 unit tests (Jest + ts-jest)
├── dist/               # Compiled output (generated)
├── tsconfig.json
├── tsconfig.test.json
└── package.json
```

### Error Architecture

All tool errors are returned as structured MCP content (not thrown exceptions), so Claude always receives a readable explanation:

```typescript
// Every error has a machine-readable code + human-readable message
{
  "success": false,
  "error": {
    "code": "OUT_OF_COVERAGE",
    "message": "Coordinates (51.5074, -0.1278) are outside Japan's coverage area..."
  }
}
```

Error codes:

| Code | Trigger |
|---|---|
| `INVALID_INPUT` | Empty string, non-Japanese text, input > 300 chars |
| `ADDRESS_NOT_FOUND` | No prefecture recognized, API returns nothing |
| `OUT_OF_COVERAGE` | Coordinates outside Japan bounding box |
| `INVALID_COORDINATES` | NaN, Infinity, or out-of-range lat/lon |
| `API_TIMEOUT` | External API did not respond within 10 seconds |
| `API_ERROR` | External API returned HTTP error |
| `NETWORK_ERROR` | Network-level failure |

---

## Data Sources

| Source | URL | License | Used for |
|---|---|---|---|
| HeartRails Express | https://express.heartrails.com | Public, no key | Address → lat/lon, postal lookup |
| Japan GSI DEM | https://cyberjapandata2.gsi.go.jp | Public domain | Elevation data |

Both APIs are free, require no authentication, and are operated by established Japanese organizations (HeartRails Co., Ltd. and the Ministry of Land, Infrastructure, Transport and Tourism respectively).

---

## Contributing

Pull requests are welcome. Please ensure:

1. `npm run lint` passes (no TypeScript errors)
2. `npm test` passes (all 26 tests green)
3. New features include corresponding tests
4. Error handling follows the existing pattern (structured `McpErrorPayload`)

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built for the Anthropic "Claude for OSS" program. Powered by official Japanese government open data.*
