import { getPublicInvoice as findPublicInvoice } from '../services/invoiceShare.service.js';

// No login: whoever has the link may see this one invoice
export const getPublicInvoice = async (req, res) => {
  const invoice = await findPublicInvoice(req.params.token);

  // The page belongs to one person and must not be kept by shared caches or listed by search engines
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.json({ invoice });
};
