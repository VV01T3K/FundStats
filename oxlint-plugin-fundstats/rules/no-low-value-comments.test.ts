import { assert, describe } from "@effect/vitest"

import { createOxlintRuleHarness } from "../test/utils.ts"

const rule = createOxlintRuleHarness("fundstats/no-low-value-comments")

describe("fundstats/no-low-value-comments", () => {
	rule.valid(
		"allows a comment that states a constraint",
		`
      // Postgres rejects a duplicate key within one upsert batch.
      export const batchSize = 100;
    `,
	)

	rule.invalid(
		"reports a comment that only repeats the name below it",
		`
      // Batch size.
      export const batchSize = 100;
    `,
		(output) => {
			assert.match(output, /only repeats the name/)
		},
	)

	rule.invalid(
		"reports a section divider",
		`
      // ---------- helpers ----------
      export const one = 1;
    `,
	)

	rule.invalid(
		"reports a task marker without a link",
		`
      // TODO handle errors
      export const one = 1;
    `,
	)
})
