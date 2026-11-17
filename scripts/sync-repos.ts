// Shallow-clones reference source for agents into git-ignored `.repos/`, at the
// tag matching the installed package. Re-running is a no-op until the version changes.
import { $ } from "bun"

const REPOS = [
	{
		id: "effect",
		repository: "https://github.com/Effect-TS/effect.git",
		packageName: "effect",
		tagPrefix: "effect@",
	},
]

const MARKER = ".synced-ref"
const say = (line: string) => Bun.write(Bun.stdout, `${line}\n`)
const root = `${import.meta.dirname}/..`

for (const repo of REPOS) {
	const { version } = (await Bun.file(`${root}/node_modules/${repo.packageName}/package.json`).json()) as {
		version: string
	}
	const ref = `${repo.tagPrefix}${version}`
	const target = `${root}/.repos/${repo.id}`
	const marker = Bun.file(`${target}/${MARKER}`)
	if ((await marker.exists()) && (await marker.text()).trim() === ref) {
		await say(`${repo.id} is already at ${ref}.`)
		continue
	}

	await say(`Syncing ${repo.id} at ${ref} (shallow clone).`)
	// Cloned next to the target so the final rename stays on one filesystem.
	const temp = `${root}/.repos/.sync-${repo.id}-${process.pid}`
	await $`mkdir -p ${temp}`
	try {
		await $`git clone --quiet --depth=1 --no-tags --single-branch --branch=${ref} ${repo.repository} ${temp}/checkout`
		await $`rm -rf ${temp}/checkout/.git`
		await Bun.write(`${temp}/checkout/${MARKER}`, `${ref}\n`)
		await $`rm -rf ${target}`
		await $`mv ${temp}/checkout ${target}`
	} finally {
		await $`rm -rf ${temp}`
	}
	await say(`${repo.id} synced to ${ref} in .repos/${repo.id}.`)
}
