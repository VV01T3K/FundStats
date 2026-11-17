import coingeckoMarkets from "./fixtures/coingecko-markets.json" with { type: "json" }
import coinmarketcapProListings from "./fixtures/coinmarketcap-pro-listings.json" with { type: "json" }
import coinmarketcapWebListing from "./fixtures/coinmarketcap-web-listing.json" with { type: "json" }
import coinpaprikaTickers from "./fixtures/coinpaprika-tickers.json" with { type: "json" }
import mbankFunds from "./fixtures/mbank-funds.json" with { type: "json" }

const FIXTURES = {
	"coingecko-markets.json": coingeckoMarkets,
	"coinmarketcap-pro-listings.json": coinmarketcapProListings,
	"coinmarketcap-web-listing.json": coinmarketcapWebListing,
	"coinpaprika-tickers.json": coinpaprikaTickers,
	"mbank-funds.json": mbankFunds,
}

/** Small real upstream samples saved under test/fixtures (the CMC pro one is shaped per its docs). */
export const fixture = (name: keyof typeof FIXTURES): unknown => structuredClone(FIXTURES[name])
