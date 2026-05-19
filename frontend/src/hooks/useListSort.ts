import { useCallback, useMemo, useState } from "react";

export type SortOrder = "asc" | "desc";

export type ListSortParams = {
  sort_by: string;
  sort_order: SortOrder;
};

export type SortableHeaderProps = {
  sortBy: string;
  active: boolean;
  order?: SortOrder;
  onSort: () => void;
};

type SortState = ListSortParams | null;

export function useListSort() {
  const [sort, setSort] = useState<SortState>(null);

  const cycleSort = useCallback((field: string) => {
    setSort((prev) => {
      if (prev?.sort_by !== field) {
        return { sort_by: field, sort_order: "asc" };
      }
      if (prev.sort_order === "asc") {
        return { sort_by: field, sort_order: "desc" };
      }
      return null;
    });
  }, []);

  const sortParams = useMemo((): ListSortParams | null => sort, [sort]);

  const getHeaderProps = useCallback(
    (field: string): SortableHeaderProps => ({
      sortBy: field,
      active: sort?.sort_by === field,
      order: sort?.sort_by === field ? sort.sort_order : undefined,
      onSort: () => cycleSort(field),
    }),
    [sort, cycleSort],
  );

  return { sortParams, getHeaderProps };
}
