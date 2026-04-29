export interface NormalizedAddress {
  original: string;
  prefecture: string;
  city: string;
  ward: string;
  block: string;
  remainder: string;
  latitude: number | null;
  longitude: number | null;
  source: string;
}

export interface GsiElevationResult {
  latitude: number;
  longitude: number;
  elevation: number | null;
  unit: string;
  hsrc: string;
}

export interface HeartRailsApiResponse {
  response: {
    location?: Array<{
      prefecture: string;
      city: string;
      town: string;
      x: string;
      y: string;
      postal: string;
    }>;
    error?: string;
  };
}

export interface GsiElevationApiResponse {
  elevation: number;
  hsrc: string;
}

export interface McpErrorPayload {
  code: string;
  message: string;
  details?: string;
}
