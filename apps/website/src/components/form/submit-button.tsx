import { useFormContext } from "../../integrations/tanstack/form/context";

export type SubmitButtonProps = {
  label: string;
  pendingLabel?: string;
};

export function SubmitButton(props: SubmitButtonProps) {
  const form = useFormContext();

  return (
    <form.Subscribe
      selector={(state) => ({
        canSubmit: state.canSubmit,
        isSubmitting: state.isSubmitting,
      })}
    >
      {(state) => (
        <button
          type="submit"
          disabled={!state().canSubmit}
          class="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state().isSubmitting ? (props.pendingLabel ?? "Submitting…") : props.label}
        </button>
      )}
    </form.Subscribe>
  );
}
