/**
 * Starts a throwaway Postgres for the database tests with testcontainers
 * (random host port, removed afterwards). Set TEST_DATABASE_URL to use an
 * existing empty database instead, e.g. the compose.dev.yaml one.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { TestProject } from "vitest/node"

declare module "vitest" {
	export interface ProvidedContext {
		databaseUrl: string
	}
}

let container: StartedPostgreSqlContainer | undefined

export async function setup(project: TestProject) {
	const external = process.env.TEST_DATABASE_URL
	if (external) {
		project.provide("databaseUrl", external)
		return
	}
	container = await new PostgreSqlContainer("postgres:18-alpine")
		.withName(`fundstats-v2-test-${process.pid}-${Date.now()}`)
		.withDatabase("fundstats_test")
		.start()
	project.provide("databaseUrl", container.getConnectionUri())
}

export async function teardown() {
	await container?.stop()
}
