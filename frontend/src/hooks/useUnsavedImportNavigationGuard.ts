import { useCallback, useEffect } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";
import { cancelStagedImportKeepalive } from "../api/earningsImport";

export type UnsavedImportNavigationGuardOptions = {
  /**
   * True when a server-side preview session exists (CSV parsed and staged) but the user has not finished import
   * (commit or cancel clears this).
   */
  isDirty: boolean;
  /** When false, navigation is not blocked (e.g. import modal closed). Defaults to true. */
  enabled?: boolean;
  /** Current staged import id (for best-effort DELETE on tab close via `pagehide`). */
  stagedImportId?: string | null;
};

/**
 * Blocks in-app navigation (React Router) and warns on tab close / refresh (beforeunload) when import preview is dirty.
 * Pair with a modal: when `blocker.state === "blocked"`, call `blocker.proceed()` to leave or `blocker.reset()` to stay.
 *
 * Requires a **data router** (`createBrowserRouter` + `RouterProvider`). `useBlocker` does not run under legacy `BrowserRouter`.
 *
 * When `stagedImportId` is set, registers `pagehide` (non-persisted) to fire a keepalive DELETE so closing the tab
 * still cleans up server staging. In-app leave should still await `cancelEarningsImport` before `proceed()`.
 */
export function useUnsavedImportNavigationGuard({
  isDirty,
  enabled = true,
  stagedImportId = null,
}: UnsavedImportNavigationGuardOptions) {
  const shouldBlock = Boolean(enabled && isDirty);

  const whenToBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      if (!shouldBlock) return false;
      return (
        currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash
      );
    },
    [shouldBlock],
  );

  const blocker = useBlocker(whenToBlock);

  useEffect(() => {
    if (!shouldBlock) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [shouldBlock]);

  useEffect(() => {
    if (!shouldBlock || !stagedImportId) return;
    const onPageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      cancelStagedImportKeepalive(stagedImportId);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [shouldBlock, stagedImportId]);

  return { blocker, shouldBlock };
}
