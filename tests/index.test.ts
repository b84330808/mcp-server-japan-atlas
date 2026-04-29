import axios from "axios";
import { parseAddressLocally, normalizeJpAddress, AddressNormalizationError } from "../src/address";
import { getGsiElevation, ElevationError } from "../src/elevation";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ─── parseAddressLocally (pure, no network) ──────────────────────────────────

describe("parseAddressLocally", () => {
  it("extracts prefecture from a Tokyo address", () => {
    const result = parseAddressLocally("東京都渋谷区道玄坂1-2-3");
    expect(result.prefecture).toBe("東京都");
  });

  it("extracts city from an Osaka address", () => {
    const result = parseAddressLocally("大阪府大阪市北区梅田1丁目");
    expect(result.prefecture).toBe("大阪府");
    expect(result.city).toBe("大阪市");
  });

  it("extracts ward when city is a designated city", () => {
    // 大阪市 (city ending in 市) → 北区 is the ward
    const result = parseAddressLocally("大阪府大阪市北区梅田1丁目");
    expect(result.ward).toBe("北区");
  });

  it("extracts block number even with a town name prefix", () => {
    // 道玄坂 is the town name; block is the numeric part
    const result = parseAddressLocally("東京都渋谷区道玄坂1-2-3");
    expect(result.block).toBe("1-2-3");
  });

  it("sets latitude/longitude to null (no network call)", () => {
    const result = parseAddressLocally("東京都千代田区丸の内1丁目");
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it("handles address without city or ward gracefully", () => {
    const result = parseAddressLocally("北海道稚内市");
    expect(result.prefecture).toBe("北海道");
    expect(result.city).toBe("稚内市");
    expect(result.ward).toBe("");
  });

  it("returns empty prefecture for non-Japanese string", () => {
    const result = parseAddressLocally("123 Main Street");
    expect(result.prefecture).toBe("");
  });

  it("trims whitespace from input", () => {
    const result = parseAddressLocally("  東京都  渋谷区  ");
    expect(result.prefecture).toBe("東京都");
  });

  it("handles all 47 prefecture patterns - Okinawa", () => {
    const result = parseAddressLocally("沖縄県那覇市泉崎1丁目");
    expect(result.prefecture).toBe("沖縄県");
    expect(result.city).toBe("那覇市");
  });

  it("handles Kyoto-fu correctly", () => {
    const result = parseAddressLocally("京都府京都市中京区");
    expect(result.prefecture).toBe("京都府");
    expect(result.city).toBe("京都市");
  });
});

// ─── normalizeJpAddress (with mocked axios) ──────────────────────────────────

describe("normalizeJpAddress", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns enriched result when GSI address search responds successfully", async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [139.700531, 35.657677] },
          properties: { title: "東京都渋谷区道玄坂", addressCode: "" },
        },
      ],
    });

    const result = await normalizeJpAddress("東京都渋谷区道玄坂1-2-3");
    expect(result.prefecture).toBe("東京都");
    expect(result.city).toBe("渋谷区");
    expect(result.latitude).toBeCloseTo(35.657677, 3);
    expect(result.longitude).toBeCloseTo(139.700531, 3);
    expect(result.source).toBe("gsi-address-search");
  });

  it("falls back to local parse when GSI API times out", async () => {
    const timeoutError = Object.assign(new Error("timeout"), { code: "ECONNABORTED", isAxiosError: true });
    mockedAxios.get = jest.fn().mockRejectedValue(timeoutError);
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

    const result = await normalizeJpAddress("東京都新宿区西新宿2丁目");
    expect(result.prefecture).toBe("東京都");
    expect(result.city).toBe("新宿区");
    expect(result.latitude).toBeNull();
    expect(result.source).toContain("local-regex");
  });

  it("throws AddressNormalizationError for empty input", async () => {
    await expect(normalizeJpAddress("   ")).rejects.toBeInstanceOf(AddressNormalizationError);
  });

  it("throws AddressNormalizationError for non-Japanese input", async () => {
    await expect(normalizeJpAddress("1600 Amphitheatre Parkway")).rejects.toMatchObject({
      payload: { code: "INVALID_INPUT" },
    });
  });

  it("throws AddressNormalizationError for input exceeding 300 chars", async () => {
    const longInput = "東".repeat(301);
    await expect(normalizeJpAddress(longInput)).rejects.toMatchObject({
      payload: { code: "INVALID_INPUT" },
    });
  });

  it("throws ADDRESS_NOT_FOUND when no prefecture matches and API returns no location", async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({ data: [] });
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);

    await expect(normalizeJpAddress("あいうえおかきくけこさしすせそ")).rejects.toMatchObject({
      payload: { code: "ADDRESS_NOT_FOUND" },
    });
  });

  it("preserves original address in result", async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: [{ type: "Feature", geometry: { type: "Point", coordinates: [141.3, 43.06] }, properties: { title: "北海道札幌市", addressCode: "" } }],
    });

    const input = "北海道札幌市中央区大通西1丁目";
    const result = await normalizeJpAddress(input);
    expect(result.original).toBe(input);
  });
});

// ─── getGsiElevation (with mocked axios) ─────────────────────────────────────

describe("getGsiElevation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns elevation for valid Tokyo coordinates", async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { elevation: 37.5, hsrc: "5m" },
    });

    const result = await getGsiElevation(35.6762, 139.6503);
    expect(result.elevation).toBe(37.5);
    expect(result.unit).toBe("metres");
    expect(result.hsrc).toBe("5m");
    expect(result.latitude).toBe(35.6762);
    expect(result.longitude).toBe(139.6503);
  });

  it("returns null elevation when GSI returns -9999 (sea/no data)", async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { elevation: -9999, hsrc: "none" },
    });

    const result = await getGsiElevation(35.0, 135.0);
    expect(result.elevation).toBeNull();
  });

  it("throws ElevationError for coordinates outside Japan", async () => {
    await expect(getGsiElevation(51.5074, -0.1278)).rejects.toBeInstanceOf(ElevationError);
  });

  it("throws ElevationError with OUT_OF_COVERAGE code for London coordinates", async () => {
    await expect(getGsiElevation(51.5074, -0.1278)).rejects.toMatchObject({
      payload: { code: "OUT_OF_COVERAGE" },
    });
  });

  it("throws ElevationError for invalid latitude", async () => {
    await expect(getGsiElevation(999, 139.0)).rejects.toMatchObject({
      payload: { code: "INVALID_COORDINATES" },
    });
  });

  it("throws ElevationError on API timeout", async () => {
    const timeoutError = Object.assign(new Error("timeout"), {
      code: "ECONNABORTED",
      isAxiosError: true,
      response: undefined,
    });
    mockedAxios.get = jest.fn().mockRejectedValue(timeoutError);
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

    await expect(getGsiElevation(35.6762, 139.6503)).rejects.toMatchObject({
      payload: { code: "API_TIMEOUT" },
    });
  });

  it("throws ElevationError on HTTP 500 from GSI", async () => {
    const httpError = Object.assign(new Error("Internal Server Error"), {
      isAxiosError: true,
      response: { status: 500 },
      code: undefined,
    });
    mockedAxios.get = jest.fn().mockRejectedValue(httpError);
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

    await expect(getGsiElevation(35.6762, 139.6503)).rejects.toMatchObject({
      payload: { code: "API_ERROR" },
    });
  });

  it("throws ElevationError for non-finite coordinates", async () => {
    await expect(getGsiElevation(NaN, 139.0)).rejects.toMatchObject({
      payload: { code: "INVALID_COORDINATES" },
    });
  });

  it("accepts boundary coordinates within Japan", async () => {
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { elevation: 10, hsrc: "10m" },
    });

    await expect(getGsiElevation(24.0, 124.0)).resolves.not.toThrow();
  });
});
