import { useContext } from 'react';
import { ReceivablesContext } from '../context/ReceivablesContext';

// { summary, reload }: summary is null until the first answer (or when it could not be fetched)
export function useReceivables() {
  const context = useContext(ReceivablesContext);
  if (!context) {
    throw new Error('useReceivables must be used inside <ReceivablesProvider>');
  }
  return context;
}
