/**
 * Vitest global setup of every workspace with database tests. Starts a throwaway Postgres with testcontainers
 * (random host port, removed afterwards). Set TEST_DATABASE_URL to use an
 * existing empty database instead, e.g. the compose.dev.yaml one.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { TestProject } from "vitest/node"

import { DATABASE_URL } from "./context.ts"

let container: StartedPostgreSqlContainer | undefined

export async function setup(project: TestProject) {
	const external = process.env.TEST_DATABASE_URL
	if (external) {
		project.provide(DATABASE_URL, external)
		return
	}
	container = await new PostgreSqlContainer(
		"postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15",
	)
		.withLabels({ "fundstats.test.pid": String(process.pid) })
		.withDatabase("fundstats_test")
		.start()
	project.provide(DATABASE_URL, container.getConnectionUri())
}

export async function teardown() {
	await container?.stop()
}
