/**
 * The Nitro boot plugin: the process waits for the API's services, closes them with the server, and
 * ends instead of staying up answering 500s when they cannot start.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const api = { ready: Promise.resolve(), dispose: vi.fn<() => Promise<void>>() }
vi.mock("#/server/api.ts", () => ({ api }))

const closeHooks: Array<() => unknown> = []
const nitroApp = { hooks: { hook: (name: string, fn: () => unknown) => name === "close" && closeHooks.push(fn) } }

const runPlugin = async () => {
	const { default: plugin } = await import("#/server/boot.ts")
	await plugin(nitroApp as never)
}

afterEach(() => {
	vi.restoreAllMocks()
	api.dispose.mockReset()
	closeHooks.length = 0
})

describe("boot plugin", () => {
	it("waits for the API and closes it when Nitro closes", async () => {
		api.ready = Promise.resolve()
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		await runPlugin()
		expect(exit).not.toHaveBeenCalled()
		expect(api.dispose).not.toHaveBeenCalled()
		await Promise.all(closeHooks.map((close) => close()))
		expect(api.dispose).toHaveBeenCalledOnce()
	})

	it("exits with status 1 when the API cannot start", async () => {
		api.ready = Promise.reject(new Error("DATABASE_URL is missing"))
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		vi.spyOn(console, "error").mockImplementation(() => {})
		await runPlugin()
		expect(exit).toHaveBeenCalledWith(1)
	})
})
