// CoinGecko's free API allows only a few calls per minute, so one markets response (which
// already holds every period) is shared by all table variants and kept for CACHE_MS.
// If CoinGecko fails or rate-limits, the last good response is served instead.

export const coinGeckoPeriods = ["1y", "200d", "30d", "7d", "24h"] as const;
export type CoinGeckoPeriod = (typeof coinGeckoPeriods)[number];

export interface CoinGeckoCoin {
    id: string;
    name: string;
    market_cap_rank: number | null;
    [key: `price_change_percentage_${string}_in_currency`]: number | null | undefined;
}

export interface CoinGeckoMarkets {
    coins: CoinGeckoCoin[];
    fetchedAt: Date;
    error: string;
}

const CACHE_MS = 10 * 60 * 1000;

const queryOptions = new URLSearchParams({
    vs_currency: "pln",
    order: "market_cap_desc",
    per_page: "100",
    page: "1",
    price_change_percentage: coinGeckoPeriods.join(","),
});
const url = `https://api.coingecko.com/api/v3/coins/markets?${queryOptions}`;

let cached: { coins: CoinGeckoCoin[]; fetchedAt: Date } | null = null;
let inFlight: Promise<CoinGeckoMarkets> | null = null;

async function fetchMarkets(): Promise<CoinGeckoMarkets> {
    // Public keyless API; an optional demo key raises the rate limit.
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = import.meta.env.COINGECKO_API_KEY;
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    let error: string;
    try {
        const response = await fetch(url, { headers });
        if (response.ok) {
            cached = { coins: await response.json(), fetchedAt: new Date() };
            return { ...cached, error: "" };
        }
        error =
            response.status === 429
                ? "CoinGecko rate limit hit, try again in a minute."
                : `CoinGecko error ${response.status}`;
    } catch (e) {
        error = `CoinGecko request failed: ${e}`;
    }
    if (cached) return { ...cached, error: "" };
    return { coins: [], fetchedAt: new Date(), error };
}

export async function getCoinGeckoMarkets(): Promise<CoinGeckoMarkets> {
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MS) return { ...cached, error: "" };
    // Concurrent requests share one upstream call.
    inFlight ??= fetchMarkets().finally(() => (inFlight = null));
    return inFlight;
}
