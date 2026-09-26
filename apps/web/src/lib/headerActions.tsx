import { createContext, useContext, useEffect, type ReactNode } from 'react';

/** Lets a route render into Shell's mobile top bar, on the same line as the tab title. */
export const HeaderActionsContext = createContext<(node: ReactNode) => void>(() => {});

export function useHeaderActions(node: ReactNode) {
  const setActions = useContext(HeaderActionsContext);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  });
}
