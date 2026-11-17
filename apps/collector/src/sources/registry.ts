import type { SourceId } from "@fundstats/shared/sources"

import { coingecko } from "./coingecko.ts"
import { coinmarketcap } from "./coinmarketcap.ts"
import { coinpaprika } from "./coinpaprika.ts"
import { mbank } from "./mbank.ts"
import type { AnySource } from "./Source.ts"

/** Every source the collector runs and the API serves. */
export const registry = {
	mbank,
	coingecko,
	coinpaprika,
	coinmarketcap,
} as const satisfies Record<SourceId, AnySource>
