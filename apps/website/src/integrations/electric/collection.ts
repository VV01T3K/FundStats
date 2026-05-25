import { snakeCamelMapper } from "@electric-sql/client";

export function appShapeOptions(url: string) {
  return {
    url,
    columnMapper: snakeCamelMapper(),
  };
}
