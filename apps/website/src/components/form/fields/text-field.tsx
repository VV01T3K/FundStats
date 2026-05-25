import { useFieldContext } from "../../../integrations/tanstack/form/context";
import { FieldErrorMessage } from "../../../integrations/tanstack/form/error-message";

export type TextFieldProps = {
  label: string;
  type?: "text" | "email" | "url" | "search" | "date";
  placeholder?: string;
  autocomplete?: string;
};

export function TextField(props: TextFieldProps) {
  const field = useFieldContext<string>();
  const id = () => `field-${field().name}`;

  return (
    <div class="flex flex-col gap-1.5">
      <label for={id()} class="text-sm font-medium text-foreground">
        {props.label}
      </label>
      <input
        id={id()}
        name={field().name}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        autocomplete={props.autocomplete}
        value={field().state.value ?? ""}
        onBlur={() => field().handleBlur()}
        onInput={(event) => field().handleChange(event.currentTarget.value)}
        class="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
      />
      <FieldErrorMessage field={field} />
    </div>
  );
}
