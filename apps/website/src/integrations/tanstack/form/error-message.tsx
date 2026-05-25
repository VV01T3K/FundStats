import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { AnyFieldApi } from "@tanstack/solid-form";

function toMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

export function FieldErrorMessage(props: { field: Accessor<AnyFieldApi> }) {
  const message = () => {
    const meta = props.field().state.meta;
    if (!meta.isTouched) return null;
    for (const error of meta.errors) {
      const msg = toMessage(error);
      if (msg) return msg;
    }
    return null;
  };

  return (
    <Show when={message()}>
      <p class="text-xs text-red-600" role="alert">
        {message()}
      </p>
    </Show>
  );
}
