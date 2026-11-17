/**
 * The Nitro boot plugin: the backend starts with the process, and a failed
 * start ends the process instead of leaving it up answering 500s.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const getServer = vi.fn<() => Promise<unknown>>()
vi.mock("#/server/runtime.ts", () => ({ getServer }))

const runPlugin = async () => {
	const { default: plugin } = await import("#/server/boot.ts")
	await plugin({} as never)
}

afterEach(() => {
	vi.restoreAllMocks()
	getServer.mockReset()
})

describe("boot plugin", () => {
	it("builds the server when the plugin runs", async () => {
		getServer.mockResolvedValue({})
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		await runPlugin()
		expect(getServer).toHaveBeenCalledOnce()
		expect(exit).not.toHaveBeenCalled()
	})

	it("exits with status 1 when the server cannot start", async () => {
		getServer.mockRejectedValue(new Error("DATABASE_URL is missing"))
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		vi.spyOn(console, "error").mockImplementation(() => {})
		await runPlugin()
		expect(exit).toHaveBeenCalledWith(1)
	})
})
