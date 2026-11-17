import { Config, Context, type Duration, Effect, Layer, Option, Redacted } from "effect"
import { SOURCE_IDS } from "#/shared/sources.ts"

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
				dbPoolMax: Config.Int("DB_POOL_MAX").pipe(Config.withDefault(10)),
				runMigrations: Config.Boolean("RUN_MIGRATIONS").pipe(Config.withDefault(true)),
				migrationsDir: Config.String("MIGRATIONS_DIR").pipe(Config.withDefault("./drizzle")),
				collectorEnabled: Config.Boolean("COLLECTOR_ENABLED").pipe(Config.withDefault(true)),
				rawPayloadRetentionDays: Config.Int("RAW_PAYLOAD_RETENTION_DAYS").pipe(Config.withDefault(30)),
				coingeckoApiKey: Config.Redacted("COINGECKO_API_KEY").pipe(Config.option),
				cmcApiKey: Config.Redacted("CMC_API_KEY").pipe(Config.option),
			})
			// Overrides are read eagerly for known sources so a typo fails at boot.
			const overrides = new Map<string, Duration.Duration>()
			for (const id of SOURCE_IDS) {
				const value = yield* Config.Duration(`COLLECTOR_INTERVAL_${id.toUpperCase()}`).pipe(Config.option)
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
