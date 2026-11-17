import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Small real upstream samples saved under test/fixtures (the CMC pro one is shaped per its docs). */
export const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"))
