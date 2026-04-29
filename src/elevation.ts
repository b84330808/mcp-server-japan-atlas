import axios, { AxiosError } from "axios";
import type { GsiElevationResult, GsiElevationApiResponse, McpErrorPayload } from "./types.js";

const GSI_ELEVATION_API = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php";
const REQUEST_TIMEOUT_MS = 10_000;

// Japan's approximate bounding box
const JAPAN_BOUNDS = {
  lat: { min: 20.4, max: 45.6 },
  lon: { min: 122.9, max: 153.0 },
} as const;

export class ElevationError extends Error {
  constructor(
    public readonly payload: McpErrorPayload,
    message: string
  ) {
    super(message);
    this.name = "ElevationError";
  }
}

function validateCoordinates(lat: number, lon: number): void {
  if (!isFinite(lat) || !isFinite(lon)) {
    throw new ElevationError(
      { code: "INVALID_COORDINATES", message: "Latitude and longitude must be finite numbers." },
      "Non-finite coordinates"
    );
  }
  if (lat < -90 || lat > 90) {
    throw new ElevationError(
      { code: "INVALID_COORDINATES", message: `Latitude ${lat} is out of range. Must be between -90 and 90.` },
      "Latitude out of range"
    );
  }
  if (lon < -180 || lon > 180) {
    throw new ElevationError(
      { code: "INVALID_COORDINATES", message: `Longitude ${lon} is out of range. Must be between -180 and 180.` },
      "Longitude out of range"
    );
  }
  if (
    lat < JAPAN_BOUNDS.lat.min ||
    lat > JAPAN_BOUNDS.lat.max ||
    lon < JAPAN_BOUNDS.lon.min ||
    lon > JAPAN_BOUNDS.lon.max
  ) {
    throw new ElevationError(
      {
        code: "OUT_OF_COVERAGE",
        message: `Coordinates (${lat}, ${lon}) are outside Japan's coverage area. The GSI API only covers Japanese territory (lat: ${JAPAN_BOUNDS.lat.min}–${JAPAN_BOUNDS.lat.max}, lon: ${JAPAN_BOUNDS.lon.min}–${JAPAN_BOUNDS.lon.max}).`,
      },
      "Coordinates outside Japan"
    );
  }
}

/**
 * Retrieves the elevation at the given coordinates using the Japan GSI DEM API.
 * No API key required. Returns elevation in metres above sea level.
 */
export async function getGsiElevation(
  lat: number,
  lon: number
): Promise<GsiElevationResult> {
  validateCoordinates(lat, lon);

  let rawResponse: GsiElevationApiResponse;

  try {
    const { data } = await axios.get<GsiElevationApiResponse>(GSI_ELEVATION_API, {
      params: { lon, lat, outtype: "JSON" },
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "Accept": "application/json" },
    });
    rawResponse = data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError;
      if (axiosErr.code === "ECONNABORTED") {
        throw new ElevationError(
          {
            code: "API_TIMEOUT",
            message: "The GSI Elevation API did not respond within the 10-second timeout. Please retry.",
          },
          "GSI API timeout"
        );
      }
      if (axiosErr.response) {
        throw new ElevationError(
          {
            code: "API_ERROR",
            message: `GSI Elevation API returned HTTP ${axiosErr.response.status}. The service may be temporarily unavailable.`,
          },
          `GSI HTTP ${axiosErr.response.status}`
        );
      }
      throw new ElevationError(
        {
          code: "NETWORK_ERROR",
          message: `Network error while contacting GSI API: ${axiosErr.message}`,
        },
        "Network error"
      );
    }
    throw new ElevationError(
      { code: "UNKNOWN_ERROR", message: "An unexpected error occurred while fetching elevation data." },
      "Unknown error"
    );
  }

  // GSI returns elevation: -9999 for sea/undetermined areas
  const elevation =
    rawResponse.elevation === -9999 || rawResponse.elevation == null
      ? null
      : rawResponse.elevation;

  return {
    latitude: lat,
    longitude: lon,
    elevation,
    unit: "metres",
    hsrc: rawResponse.hsrc ?? "unknown",
  };
}
