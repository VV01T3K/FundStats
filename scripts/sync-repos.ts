// Shallow-clones reference source for agents into git-ignored `.repos/`, at the
// tag matching the installed package. Re-running is a no-op until the version changes.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

interface ReferenceRepo {
	readonly id: string
	readonly repository: string
	readonly packageName: string
	readonly tagPrefix: string
}

const REPOS: ReadonlyArray<ReferenceRepo> = [
	{
		id: "effect",
		repository: "https://github.com/Effect-TS/effect.git",
		packageName: "effect",
		tagPrefix: "effect@",
	},
]

const MARKER = ".synced-ref"

class GitError extends Schema.TaggedError<GitError>()("GitError", {
	args: Schema.Array(Schema.String),
	exitCode: Schema.Number,
	stderr: Schema.String,
}) {
	override get message() {
		return `git ${this.args.join(" ")} exited with ${this.exitCode}: ${this.stderr.trim()}`
	}
}

const PackageVersion = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
const decodePackageVersion = Schema.decodeUnknownEffect(PackageVersion)

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
	stream.pipe(
		Stream.decodeText(),
		Stream.runFold(
			() => "",
			(acc, chunk) => acc + chunk,
		),
	)

const git = Effect.fn("SyncRepos.git")(function* (cwd: string, args: ReadonlyArray<string>) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const child = yield* spawner.spawn(ChildProcess.make("git", [...args], { cwd }))
	const [stderr, exitCode] = yield* Effect.all([collectText(child.stderr), child.exitCode], {
		concurrency: "unbounded",
	})
	if (exitCode !== 0) {
		return yield* new GitError({ args: [...args], exitCode: Number(exitCode), stderr })
	}
}, Effect.scoped)

const syncRepo = Effect.fn("SyncRepos.syncRepo")(function* (rootDir: string, repo: ReferenceRepo) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const manifest = yield* fs.readFileString(path.join(rootDir, "node_modules", repo.packageName, "package.json"))
	const { version } = yield* decodePackageVersion(manifest)
	const ref = `${repo.tagPrefix}${version}`
	const reposDir = path.join(rootDir, ".repos")
	const target = path.join(reposDir, repo.id)
	const markerPath = path.join(target, MARKER)

	const current = yield* fs.readFileString(markerPath).pipe(Effect.orElseSucceed(() => ""))
	if (current.trim() === ref) {
		yield* Console.log(`${repo.id} is already at ${ref}.`)
		return
	}

	yield* Console.log(`Syncing ${repo.id} at ${ref} (shallow clone).`)
	yield* fs.makeDirectory(reposDir, { recursive: true })
	// Cloned next to the target so the final rename stays on one filesystem.
	const tempDir = yield* fs.makeTempDirectoryScoped({ directory: reposDir, prefix: `.sync-${repo.id}-` })
	const checkout = path.join(tempDir, "checkout")
	yield* git(rootDir, [
		"clone",
		"--quiet",
		"--depth=1",
		"--no-tags",
		"--single-branch",
		`--branch=${ref}`,
		repo.repository,
		checkout,
	])
	yield* fs.remove(path.join(checkout, ".git"), { recursive: true })
	yield* fs.writeFileString(path.join(checkout, MARKER), `${ref}\n`)
	yield* fs.remove(target, { recursive: true, force: true })
	yield* fs.rename(checkout, target)
	yield* Console.log(`${repo.id} synced to ${ref} in .repos/${repo.id}.`)
}, Effect.scoped)

const syncAll = Effect.fn("SyncRepos.syncAll")(function* () {
	const path = yield* Path.Path
	const rootDir = path.resolve(import.meta.dirname, "..")
	for (const repo of REPOS) {
		yield* syncRepo(rootDir, repo)
	}
})

syncAll().pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
