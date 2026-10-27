import Badge from './Badge';

const STATUS = {
  draft: { tone: 'slate', label: 'Draft' },
  sent: { tone: 'warning', label: 'Sent' }, // amber
  paid: { tone: 'success', label: 'Paid' }, // emerald
};

export default function InvoiceStatusBadge({ status }) {
  const { tone, label } = STATUS[status] ?? STATUS.draft;
  return <Badge tone={tone}>{label}</Badge>;
}
