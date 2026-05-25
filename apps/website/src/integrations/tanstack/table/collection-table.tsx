import { useLiveQuery, type Collection, type IR } from "@tanstack/solid-db";
import { createColumnHelper } from "@tanstack/solid-table";
import { createSignal, type JSX } from "solid-js";

type SortKey<TData extends object> = Extract<keyof TData, string>;

interface CollectionTableSort<TData extends object> {
  key: SortKey<TData>;
  direction: "asc" | "desc";
}

interface CollectionTableQueryOptions<TData extends object> {
  collection: Collection<TData>;
  defaultSort: CollectionTableSort<TData>;
  sortable?: ReadonlyArray<SortKey<TData>>;
  search?: (row: TData, pattern: string) => IR.BasicExpression<boolean>;
}

interface CollectionTableField<TData extends object, TKey extends SortKey<TData> = SortKey<TData>> {
  key: TKey;
  header: string;
  width: string;
  class?: string;
  cell?: (value: any) => JSX.Element;
}

export function createCollectionTableColumns<TData extends object>(
  fields: ReadonlyArray<CollectionTableField<TData>>,
) {
  const columnHelper = createColumnHelper<TData>();

  return {
    columnGrid: fields.map((field) => field.width).join(" "),
    columns: fields.map((field) =>
      columnHelper.accessor(field.key as any, {
        header: field.header,
        cell: (info) => {
          const value = info.getValue();

          if (field.cell) {
            return field.cell(value);
          }

          return <span class={field.class}>{String(value)}</span>;
        },
      }),
    ),
  };
}

export function createCollectionTableQuery<TData extends object>(
  options: CollectionTableQueryOptions<TData>,
) {
  const [filter, setFilter] = createSignal("");
  const [sort, setSort] = createSignal(options.defaultSort);

  const rows = useLiveQuery((query) => {
    const currentSort = sort();
    const trimmedFilter = filter().trim();
    const search = options.search;

    const baseQuery = query.from({ row: options.collection });
    const filteredQuery =
      trimmedFilter && search
        ? baseQuery.where(({ row }) => search(row as TData, `%${trimmedFilter}%`))
        : baseQuery;

    return filteredQuery.orderBy(
      ({ row }) => (row as Record<SortKey<TData>, unknown>)[currentSort.key],
      currentSort.direction,
    );
  });

  const isSortable = (key: string) =>
    !options.sortable || options.sortable.includes(key as SortKey<TData>);

  return {
    rows,
    filter,
    setFilter,
    sort,
    isSortable,
    nextSort: (key: string) => {
      if (!isSortable(key)) {
        return;
      }

      const sortKey = key as SortKey<TData>;

      setSort((current) =>
        current.key === sortKey
          ? { key: sortKey, direction: current.direction === "asc" ? "desc" : "asc" }
          : { key: sortKey, direction: "asc" },
      );
    },
  };
}
