import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { SOURCE_IDS } from "#/shared/sources.ts"

/** Shortest accepted collector interval; anything lower would hammer the upstreams. */
export const MIN_INTERVAL = Duration.minutes(1)

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0, { message: "must be a positive integer" }))

const Interval = Schema.DurationFromString.check(
	Schema.makeFilter((d: Duration.Duration) =>
		Duration.isFinite(d) && Duration.isGreaterThanOrEqualTo(d, MIN_INTERVAL)
			? true
			: `must be a finite duration of at least ${Duration.format(MIN_INTERVAL)}`,
	),
)

/** Shortest accepted statement timeout; anything lower would cancel ordinary queries. */
export const MIN_STATEMENT_TIMEOUT = Duration.seconds(1)

const StatementTimeout = Schema.DurationFromString.check(
	Schema.makeFilter((d: Duration.Duration) =>
		Duration.isFinite(d) && Duration.isGreaterThanOrEqualTo(d, MIN_STATEMENT_TIMEOUT)
			? true
			: `must be a finite duration of at least ${Duration.format(MIN_STATEMENT_TIMEOUT)}`,
	),
)

/**
 * All environment configuration, read once through Effect Config when the
 * runtime is built. A missing or malformed value fails the boot with a
 * ConfigError naming the variable.
 */
export class AppConfig extends Context.Service<
	AppConfig,
	{
		readonly databaseUrl: Redacted.Redacted<string>
		readonly dbPoolMax: number
		/** Postgres cancels any statement (lock waits included) that runs longer. */
		readonly dbStatementTimeout: Duration.Duration
		readonly runMigrations: boolean
		readonly migrationsDir: string
		readonly collectorEnabled: boolean
		/** Per-source interval overrides from COLLECTOR_INTERVAL_<SOURCE>. */
		readonly intervalOverride: (sourceId: string) => Option.Option<Duration.Duration>
		readonly rawPayloadRetentionDays: number
		readonly coingeckoApiKey: Option.Option<Redacted.Redacted<string>>
		readonly cmcApiKey: Option.Option<Redacted.Redacted<string>>
	}
>()("fundstats/server/AppConfig") {
	static readonly layer = Layer.effect(
		AppConfig,
		Effect.gen(function* () {
			const base = yield* Config.all({
				databaseUrl: Config.Redacted("DATABASE_URL"),
				dbPoolMax: Config.schema(PositiveInt, "DB_POOL_MAX").pipe(Config.withDefault(10)),
				dbStatementTimeout: Config.schema(StatementTimeout, "DB_STATEMENT_TIMEOUT").pipe(
					Config.withDefault(Duration.seconds(30)),
				),
				runMigrations: Config.Boolean("RUN_MIGRATIONS").pipe(Config.withDefault(true)),
				migrationsDir: Config.String("MIGRATIONS_DIR").pipe(Config.withDefault("./drizzle")),
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
			return AppConfig.of({
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
