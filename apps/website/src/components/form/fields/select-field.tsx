import { For } from "solid-js";

import { useFieldContext } from "../../../integrations/tanstack/form/context";
import { FieldErrorMessage } from "../../../integrations/tanstack/form/error-message";

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = {
  label: string;
  options: ReadonlyArray<SelectOption>;
};

export function SelectField(props: SelectFieldProps) {
  const field = useFieldContext<string>();
  const id = () => `field-${field().name}`;

  return (
    <div class="flex flex-col gap-1.5">
      <label for={id()} class="text-sm font-medium text-foreground">
        {props.label}
      </label>
      <select
        id={id()}
        name={field().name}
        value={field().state.value}
        onBlur={() => field().handleBlur()}
        onChange={(event) => field().handleChange(event.currentTarget.value)}
        class="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
      >
        <For each={props.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
      <FieldErrorMessage field={field} />
    </div>
  );
}
