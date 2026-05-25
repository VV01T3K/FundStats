import { Link, createFileRoute } from "@tanstack/solid-router";
import { Show, createSignal } from "solid-js";

import { getFundStatsCollection } from "../integrations/tanstack/db/fund-stats";
import { fundStatSchema } from "../db/fund-stats.schema";
import { useAppForm } from "../integrations/tanstack/form/hook";

export const Route = createFileRoute("/funds/new")({
  ssr: false,
  component: NewFundPage,
});

const riskOptions = [
  { value: "Low", label: "Low" },
  { value: "Moderate", label: "Moderate" },
  { value: "Elevated", label: "Elevated" },
  { value: "High", label: "High" },
] as const;

function NewFundPage() {
  const [lastAdded, setLastAdded] = createSignal<string | null>(null);

  const form = useAppForm(() => ({
    defaultValues: {
      symbol: "",
      fundName: "",
      category: "",
      region: "",
      nav: 0,
      netAssets: 0,
      expenseRatio: 0,
      ytdReturn: 0,
      oneYearReturn: 0,
      threeYearReturn: 0,
      risk: "Moderate" as "Low" | "Moderate" | "Elevated" | "High",
      asOf: new Date().toISOString().slice(0, 10),
    },
    validators: {
      onBlur: fundStatSchema.omit({ id: true }),
      onSubmit: fundStatSchema.omit({ id: true }),
    },
    onSubmit: async ({ value, formApi }) => {
      getFundStatsCollection().insert({ ...value, id: value.symbol.trim().toLowerCase() });
      setLastAdded(value.symbol.trim().toUpperCase());
      formApi.reset();
    },
  }));

  return (
    <main class="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8">
      <div class="mx-auto flex max-w-3xl flex-col gap-6">
        <header class="flex items-center justify-between border-b border-border pb-5">
          <div>
            <p class="text-sm font-medium text-muted-foreground">FundStats</p>
            <h1 class="mt-1 text-3xl font-semibold tracking-normal">Add a fund</h1>
          </div>
          <Link to="/" class="text-sm text-muted-foreground hover:text-foreground">
            ← Back to funds
          </Link>
        </header>

        <Show when={lastAdded()}>
          {(symbol) => (
            <div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              Added {symbol()} to the local collection.
            </div>
          )}
        </Show>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          class="flex flex-col gap-6"
        >
          <section class="flex flex-col gap-3">
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Identity
            </h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <form.AppField
                name="symbol"
                children={(field) => (
                  <field.TextField label="Ticker" placeholder="VTI" autocomplete="off" />
                )}
              />
              <form.AppField
                name="fundName"
                children={(field) => (
                  <field.TextField
                    label="Fund name"
                    placeholder="Vanguard Total Stock Market ETF"
                  />
                )}
              />
              <form.AppField
                name="category"
                children={(field) => (
                  <field.TextField label="Category" placeholder="Total Market" />
                )}
              />
              <form.AppField
                name="region"
                children={(field) => <field.TextField label="Region" placeholder="United States" />}
              />
              <form.AppField
                name="risk"
                children={(field) => <field.SelectField label="Risk" options={riskOptions} />}
              />
              <form.AppField
                name="asOf"
                children={(field) => <field.TextField label="As of" type="date" />}
              />
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Metrics
            </h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <form.AppField
                name="nav"
                children={(field) => <field.NumberField label="NAV (USD)" step="0.01" min={0} />}
              />
              <form.AppField
                name="netAssets"
                children={(field) => (
                  <field.NumberField
                    label="Net assets (USD)"
                    min={0}
                    hint="Total assets under management"
                  />
                )}
              />
              <form.AppField
                name="expenseRatio"
                children={(field) => (
                  <field.NumberField label="Expense ratio" step="0.01" min={0} hint="Percent" />
                )}
              />
              <form.AppField
                name="ytdReturn"
                children={(field) => (
                  <field.NumberField label="YTD return" step="0.01" hint="Percent" />
                )}
              />
              <form.AppField
                name="oneYearReturn"
                children={(field) => (
                  <field.NumberField label="1Y return" step="0.01" hint="Percent" />
                )}
              />
              <form.AppField
                name="threeYearReturn"
                children={(field) => (
                  <field.NumberField label="3Y return" step="0.01" hint="Percent" />
                )}
              />
            </div>
          </section>

          <div class="flex items-center gap-3 border-t border-border pt-5">
            <form.AppForm>
              <form.SubmitButton label="Add fund" pendingLabel="Adding…" />
            </form.AppForm>
            <button
              type="button"
              onClick={() => form.reset()}
              class="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              Reset
            </button>
            <form.Subscribe selector={(state) => state.errors}>
              {(errors) => (
                <Show when={errors().length > 0}>
                  <p class="text-xs text-red-600">Fix the highlighted fields before submitting.</p>
                </Show>
              )}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </main>
  );
}
