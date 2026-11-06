import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getReceivablesSummary } from '../api/receivables';

export const ReceivablesContext = createContext(null);

// The numbers of "who owes me what" for the whole app: the dashboard shows them and the sidebar has a badge with the overdue
// count. They are fetched again whenever the page changes and whenever the tab is looked at again, so the badge follows what
// happens on the invoice pages (marking one as paid, sending one) without anybody having to refresh.
export function ReceivablesProvider({ children }) {
  const { pathname } = useLocation();
  const [summary, setSummary] = useState(null); // null until the first answer
  const latest = useRef(0);

  const reload = useCallback(() => {
    const request = ++latest.current;
    return getReceivablesSummary()
      .then((result) => {
        if (request === latest.current) setSummary(result); // an older answer never replaces a newer one
      })
      .catch(() => {
        // Keep what we had: these numbers are extras, and the pages report connection problems themselves
      });
  }, []);

  useEffect(() => {
    reload();
  }, [pathname, reload]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const value = useMemo(() => ({ summary, reload }), [summary, reload]);
  return <ReceivablesContext.Provider value={value}>{children}</ReceivablesContext.Provider>;
}
