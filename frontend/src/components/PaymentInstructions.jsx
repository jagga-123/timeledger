import { ExternalLink } from 'lucide-react';

// "Pay now" and the other ways to pay, below the invoice the client opens. payment: { link, upiId, bankDetails } or null.
// The button only appears when the owner has a payment link; the UPI ID and bank details are shown with or without one.
export default function PaymentInstructions({ payment }) {
  if (!payment) return null;

  // The server only saves https links, and this checks again, so a link can never run script
  const link = payment.link?.startsWith('https://') ? payment.link : null;
  const hasDetails = Boolean(payment.upiId || payment.bankDetails);
  if (!link && !hasDetails) return null;

  return (
    <section
      aria-label="How to pay"
      className="mx-auto mt-6 max-w-3xl rounded-xl border border-slate-200 bg-white p-5 sm:p-6 print:mt-8 print:rounded-none print:border-0 print:p-0"
      data-testid="payment-instructions"
    >
      <h2 className="text-sm font-semibold text-slate-900">{link ? 'Pay this invoice' : 'How to pay'}</h2>

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="pay-now"
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-8 py-3 text-base font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-2 sm:w-auto print:hidden"
        >
          Pay now
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      )}

      {hasDetails && (
        <dl className={`space-y-3 text-sm ${link ? 'mt-4 border-t border-slate-200 pt-4' : 'mt-3'}`} data-testid="payment-details">
          {payment.upiId && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{link ? 'Or pay by UPI' : 'UPI ID'}</dt>
              <dd className="mt-0.5 break-all font-mono text-slate-900">{payment.upiId}</dd>
            </div>
          )}
          {payment.bankDetails && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bank details</dt>
              <dd className="mt-0.5 whitespace-pre-line break-words text-slate-900">{payment.bankDetails}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
