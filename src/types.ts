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

export interface GsiAddressFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
  };
  properties: {
    title: string;
    addressCode: string;
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
