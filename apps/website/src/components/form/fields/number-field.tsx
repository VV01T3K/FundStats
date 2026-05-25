import { useFieldContext } from "../../../integrations/tanstack/form/context";
import { FieldErrorMessage } from "../../../integrations/tanstack/form/error-message";

export type NumberFieldProps = {
  label: string;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
};

export function NumberField(props: NumberFieldProps) {
  const field = useFieldContext<number>();
  const id = () => `field-${field().name}`;

  return (
    <div class="flex flex-col gap-1.5">
      <label for={id()} class="text-sm font-medium text-foreground">
        {props.label}
      </label>
      <input
        id={id()}
        name={field().name}
        type="number"
        inputmode="decimal"
        step={props.step ?? "any"}
        min={props.min}
        max={props.max}
        placeholder={props.placeholder}
        value={Number.isFinite(field().state.value) ? field().state.value : ""}
        onBlur={() => field().handleBlur()}
        onInput={(event) => {
          const raw = event.currentTarget.value;
          field().handleChange(raw === "" ? Number.NaN : Number(raw));
        }}
        class="h-10 rounded-md border border-input bg-background px-3 text-sm tabular-nums shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
      />
      {props.hint && <p class="text-xs text-muted-foreground">{props.hint}</p>}
      <FieldErrorMessage field={field} />
    </div>
  );
}
