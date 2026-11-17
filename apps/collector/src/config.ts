import { migrationsFolder } from "@fundstats/db/Migrations"
import { SOURCE_IDS } from "@fundstats/shared/sources"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

/** Shortest accepted collector interval; anything lower would hammer the upstreams. */
const MIN_INTERVAL = Duration.minutes(1)

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0, { message: "must be a positive integer" }))

const Interval = Schema.DurationFromString.check(
	Schema.makeFilter((d: Duration.Duration) =>
		Duration.isFinite(d) && Duration.isGreaterThanOrEqualTo(d, MIN_INTERVAL)
			? true
			: `must be a finite duration of at least ${Duration.format(MIN_INTERVAL)}`,
	),
)

/**
 * The collector's environment configuration (the database settings are DbConfig), read once through
 * Effect Config when the runtime is built. A malformed value fails the start with a ConfigError naming
 * the variable.
 */
export class CollectorConfig extends Context.Service<
	CollectorConfig,
	{
		readonly runMigrations: boolean
		readonly migrationsDir: string
		readonly collectorEnabled: boolean
		/** Per-source interval overrides from COLLECTOR_INTERVAL_<SOURCE>. */
		readonly intervalOverride: (sourceId: string) => Option.Option<Duration.Duration>
		readonly rawPayloadRetentionDays: number
		readonly coingeckoApiKey: Option.Option<Redacted.Redacted<string>>
		readonly cmcApiKey: Option.Option<Redacted.Redacted<string>>
	}
>()("@fundstats/collector/config/CollectorConfig") {
	static readonly layer = Layer.effect(
		CollectorConfig,
		Effect.gen(function* () {
			const base = yield* Config.all({
				runMigrations: Config.Boolean("RUN_MIGRATIONS").pipe(Config.withDefault(true)),
				migrationsDir: Config.String("MIGRATIONS_DIR").pipe(Config.withDefault(migrationsFolder)),
				collectorEnabled: Config.Boolean("COLLECTOR_ENABLED").pipe(Config.withDefault(true)),
				rawPayloadRetentionDays: Config.schema(PositiveInt, "RAW_PAYLOAD_RETENTION_DAYS").pipe(Config.withDefault(30)),
				coingeckoApiKey: Config.Redacted("COINGECKO_API_KEY").pipe(Config.option),
				cmcApiKey: Config.Redacted("CMC_API_KEY").pipe(Config.option),
			})
			// Overrides are read eagerly for known sources so a typo fails at boot.
			const overrides = new Map<string, Duration.Duration>()
			for (const id of SOURCE_IDS) {
				const value = yield* Config.schema(Interval, `COLLECTOR_INTERVAL_${id.toUpperCase()}`).pipe(Config.option)
				if (Option.isSome(value)) overrides.set(id, value.value)
			}
			return CollectorConfig.of({
				...base,
				coingeckoApiKey: emptyAsNone(base.coingeckoApiKey),
				cmcApiKey: emptyAsNone(base.cmcApiKey),
				intervalOverride: (id) => Option.fromNullishOr(overrides.get(id)),
			})
		}),
	)
}

// `CMC_API_KEY=` in an .env file means "not set".
const emptyAsNone = (value: Option.Option<Redacted.Redacted<string>>): Option.Option<Redacted.Redacted<string>> =>
	Option.filter(value, (secret) => Redacted.value(secret).trim().length > 0)
