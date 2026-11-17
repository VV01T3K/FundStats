import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0, { message: "must be a positive integer" }))

/** Shortest accepted statement timeout; anything lower would cancel ordinary queries. */
const MIN_STATEMENT_TIMEOUT = Duration.seconds(1)

const StatementTimeout = Schema.DurationFromString.check(
	Schema.makeFilter((d: Duration.Duration) =>
		Duration.isFinite(d) && Duration.isGreaterThanOrEqualTo(d, MIN_STATEMENT_TIMEOUT)
			? true
			: `must be a finite duration of at least ${Duration.format(MIN_STATEMENT_TIMEOUT)}`,
	),
)

/** How the web app and the collector connect to Postgres, read from the environment when the layer is built. */
export class DbConfig extends Context.Service<
	DbConfig,
	{
		readonly databaseUrl: Redacted.Redacted<string>
		readonly dbPoolMax: number
		/** Postgres cancels any statement (lock waits included) that runs longer. */
		readonly dbStatementTimeout: Duration.Duration
	}
>()("@fundstats/db/DbConfig") {
	static readonly layer = Layer.effect(
		DbConfig,
		Effect.gen(function* () {
			return DbConfig.of(
				yield* Config.all({
					databaseUrl: Config.Redacted("DATABASE_URL"),
					dbPoolMax: Config.schema(PositiveInt, "DB_POOL_MAX").pipe(Config.withDefault(10)),
					dbStatementTimeout: Config.schema(StatementTimeout, "DB_STATEMENT_TIMEOUT").pipe(
						Config.withDefault(Duration.seconds(30)),
					),
				}),
			)
		}),
	)
}
