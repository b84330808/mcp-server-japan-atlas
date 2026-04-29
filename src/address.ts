import axios, { AxiosError } from "axios";
import type {
  NormalizedAddress,
  HeartRailsApiResponse,
  McpErrorPayload,
} from "./types.js";

const HEARTRAILS_API_BASE = "https://express.heartrails.com/api/json";
const REQUEST_TIMEOUT_MS = 10_000;

// Japanese prefecture names used for local regex fallback
const PREFECTURE_PATTERNS =
  /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/;

// Pattern to split off city-level and below after prefecture
const CITY_PATTERN = /^(.{2,5}?[市区町村郡])/;

// Detects strings that are entirely blank or non-address content
const EMPTY_OR_WHITESPACE = /^\s*$/;

export class AddressNormalizationError extends Error {
  constructor(
    public readonly payload: McpErrorPayload,
    message: string
  ) {
    super(message);
    this.name = "AddressNormalizationError";
  }
}

/**
 * Attempts to parse a raw Japanese address string using regex alone.
 * Returns partial structured data; lat/lon will be null.
 */
export function parseAddressLocally(raw: string): Partial<NormalizedAddress> {
  const trimmed = raw.trim().replace(/\s+/g, "");

  const prefMatch = trimmed.match(PREFECTURE_PATTERNS);
  if (!prefMatch) {
    return { original: raw, prefecture: "", city: "", ward: "", block: "", remainder: trimmed, latitude: null, longitude: null };
  }

  const prefecture = prefMatch[1];
  const afterPref = trimmed.slice(prefecture.length);
  const cityMatch = afterPref.match(CITY_PATTERN);
  const city = cityMatch ? cityMatch[1] : "";
  const afterCity = cityMatch ? afterPref.slice(city.length) : afterPref;

  // Ward-level: 区 directly after the city, common in ordinance-designated cities
  // (e.g., 大阪市北区). Not applicable when the city itself ends in 区 (Tokyo special wards).
  const wardMatch = city.endsWith("市") ? afterCity.match(/^(.{1,10}?区)/) : null;
  const ward = wardMatch ? wardMatch[1] : "";
  const afterWard = wardMatch ? afterCity.slice(ward.length) : afterCity;

  // Block: chome/ban/go pattern — e.g., 1丁目2番3号 or 1-2-3
  // Scan without anchoring so town names (e.g., 道玄坂) before the block are skipped.
  const blockMatch = afterWard.match(/([\d０-９一二三四五六七八九十]+(?:[丁目番号地\-－－]+[\d０-９一二三四五六七八九十]*)*)/);
  const block = blockMatch ? blockMatch[0] : "";
  const remainder = blockMatch ? afterWard.replace(block, "").trim() : afterWard;

  return { original: raw, prefecture, city, ward, block, remainder, latitude: null, longitude: null };
}

/**
 * Validates that the input looks like a plausible Japanese address before
 * making any network calls.
 */
function validateInput(address: string): void {
  if (EMPTY_OR_WHITESPACE.test(address)) {
    throw new AddressNormalizationError(
      { code: "INVALID_INPUT", message: "Address string must not be empty." },
      "Empty address"
    );
  }
  if (address.length > 300) {
    throw new AddressNormalizationError(
      { code: "INVALID_INPUT", message: "Address string exceeds maximum allowed length of 300 characters." },
      "Address too long"
    );
  }
  // Require at least one CJK character (Japanese) in the input
  if (!/[　-鿿豈-﫿]/.test(address)) {
    throw new AddressNormalizationError(
      {
        code: "INVALID_INPUT",
        message:
          "Input does not appear to contain Japanese characters. Please provide a Japanese address (e.g., 東京都渋谷区1-2-3).",
      },
      "No Japanese characters found"
    );
  }
}

/**
 * Normalizes a Japanese address string by querying the HeartRails Express API
 * and enriching the result with local regex parsing.
 */
export async function normalizeJpAddress(
  rawAddress: string
): Promise<NormalizedAddress> {
  validateInput(rawAddress);

  const local = parseAddressLocally(rawAddress);

  let apiPrefecture = local.prefecture ?? "";
  let apiCity = local.city ?? "";
  let latitude: number | null = local.latitude ?? null;
  let longitude: number | null = local.longitude ?? null;
  let source = "local-regex";

  try {
    const response = await axios.get<HeartRailsApiResponse>(HEARTRAILS_API_BASE, {
      params: { method: "searchByPostal", address: rawAddress },
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "Accept": "application/json" },
    });

    const locations = response.data?.response?.location;
    if (locations && locations.length > 0) {
      const loc = locations[0];
      apiPrefecture = loc.prefecture || apiPrefecture;
      apiCity = loc.city || apiCity;
      const parsedLat = parseFloat(loc.y);
      const parsedLon = parseFloat(loc.x);
      if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
        latitude = parsedLat;
        longitude = parsedLon;
        source = "heartrails-express";
      }
    }
  } catch (err) {
    // HeartRails is best-effort enrichment; fall through to local-only result
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError;
      if (axiosErr.code === "ECONNABORTED" || axiosErr.code === "ERR_NETWORK") {
        // Surface as a softer warning — we still return local parse
        source = "local-regex (HeartRails timeout)";
      } else {
        source = `local-regex (HeartRails error: ${axiosErr.message})`;
      }
    } else {
      source = "local-regex (HeartRails unavailable)";
    }
  }

  // If the API returned no result and we have no prefecture, the address is unknown
  if (!apiPrefecture && !local.prefecture) {
    throw new AddressNormalizationError(
      {
        code: "ADDRESS_NOT_FOUND",
        message: `Could not recognize prefecture from the provided address: "${rawAddress}". Ensure the address starts with a valid Japanese prefecture name (e.g., 東京都, 大阪府).`,
      },
      "Prefecture not found"
    );
  }

  return {
    original: rawAddress,
    prefecture: apiPrefecture || local.prefecture || "",
    city: apiCity || local.city || "",
    ward: local.ward || "",
    block: local.block || "",
    remainder: local.remainder || "",
    latitude,
    longitude,
    source,
  };
}
