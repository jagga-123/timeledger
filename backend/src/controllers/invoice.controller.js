import * as invoiceService from '../services/invoice.service.js';
import { sendInvoice as sendInvoiceEmail } from '../services/invoiceSend.service.js';
import { getShareUrl, regenerateShareUrl } from '../services/invoiceShare.service.js';
import { listInvoicesQuerySchema } from '../validators/invoice.validator.js';

export const previewInvoice = async (req, res) => {
  const preview = await invoiceService.preview(req.user.id, req.body);
  res.json({ preview });
};

export const createInvoice = async (req, res) => {
  const invoice = await invoiceService.create(req.user.id, req.body);
  res.status(201).json({ invoice });
};

export const listInvoices = async (req, res) => {
  const filters = listInvoicesQuerySchema.parse(req.query);
  res.json({ invoices: await invoiceService.list(req.user.id, filters) });
};

export const getInvoice = async (req, res) => {
  res.json(await invoiceService.getOne(req.user.id, req.params.id)); // { invoice, entries }
};

export const updateInvoiceStatus = async (req, res) => {
  const invoice = await invoiceService.updateStatus(req.user.id, req.params.id, req.body.status);
  res.json({ invoice });
};

export const deleteInvoice = async (req, res) => {
  await invoiceService.remove(req.user.id, req.params.id);
  res.status(204).end();
};

// Emails the invoice to the client and marks it as sent
export const sendInvoice = async (req, res) => {
  res.json(await sendInvoiceEmail(req.user.id, req.params.id, req.body)); // { invoice, sentTo, shareUrl }
};

// The link the client opens without logging in (made now if the invoice has none yet)
export const getShareLink = async (req, res) => {
  res.json({ shareUrl: await getShareUrl(req.user.id, req.params.id) });
};

// A new link; the old one stops working
export const regenerateShareLink = async (req, res) => {
  res.json({ shareUrl: await regenerateShareUrl(req.user.id, req.params.id) });
};
