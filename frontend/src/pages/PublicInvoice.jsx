import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import InvoicePaper from '../components/InvoicePaper';
import { getPublicInvoice } from '../api/invoices';

// Where "Sent with TimeLedger" leads: the start of the app (there is no separate landing page yet)
const LANDING_URL = '/';

// What a client sees when they open the link in an email: just the invoice. No login, no sidebar.
export default function PublicInvoice() {
  const { token } = useParams();
  const [state, setState] = useState({ kind: 'loading' }); // loading | ok | missing | limited | error

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    getPublicInvoice(token)
      .then((invoice) => !cancelled && setState({ kind: 'ok', invoice }))
      .catch((err) => {
        if (cancelled) return;
        const status = err.response?.status;
        setState({ kind: status === 404 ? 'missing' : status === 429 ? 'limited' : 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // A private page: a useful tab title, and no search engine should list it
  useEffect(() => {
    const previousTitle = document.title;
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    if (state.kind === 'ok') document.title = `Invoice ${state.invoice.number} from ${state.invoice.from.name}`;

    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, [state]);

  const problem = {
    missing: ['This invoice link is not valid', 'It may have been replaced by a newer link, or the invoice was removed. Ask the sender for the current link.'],
    limited: ['Too many requests', 'Please wait a minute and try again.'],
    error: ["Couldn't load the invoice", 'Check your connection and reload the page.'],
  }[state.kind];

  return (
    <div className="min-h-screen bg-page px-4 py-6 sm:py-10 print:bg-white print:p-0">
      {state.kind === 'loading' && <PageLoader compact />}

      {problem && (
        <div className="mx-auto max-w-lg pt-10">
          <EmptyState icon={FileText} title={problem[0]} description={problem[1]} />
        </div>
      )}

      {state.kind === 'ok' && (
        <>
          <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 print:hidden">
            <p className="min-w-0 truncate text-sm text-slate-600">
              Invoice from <span className="font-semibold text-slate-900">{state.invoice.from.name}</span>
            </p>
            <Button variant="secondary" onClick={() => window.print()} data-testid="download-pdf">
              <Printer size={16} />
              Download PDF
            </Button>
          </div>

          <InvoicePaper invoice={state.invoice} />
        </>
      )}

      <footer className="mx-auto mt-8 max-w-3xl text-center text-xs text-slate-500 print:hidden">
        Sent with{' '}
        <a href={LANDING_URL} className="font-semibold text-primary hover:underline" data-testid="landing-link">
          TimeLedger
        </a>
      </footer>
    </div>
  );
}
