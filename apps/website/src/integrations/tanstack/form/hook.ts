import { createFormHook } from "@tanstack/solid-form";

import { fieldContext, formContext } from "./context";
import { NumberField } from "../../../components/form/fields/number-field";
import { SelectField } from "../../../components/form/fields/select-field";
import { TextField } from "../../../components/form/fields/text-field";
import { SubmitButton } from "../../../components/form/submit-button";

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    NumberField,
    SelectField,
  },
  formComponents: {
    SubmitButton,
  },
});
