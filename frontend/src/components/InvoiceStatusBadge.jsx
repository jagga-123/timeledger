import Badge from './Badge';

const STATUS = {
  draft: { tone: 'slate', label: 'Draft' },
  sent: { tone: 'warning', label: 'Sent' }, // amber
  overdue: { tone: 'danger', label: 'Overdue' }, // red
  paid: { tone: 'success', label: 'Paid' }, // emerald
};

// status is the invoice's displayStatus (draft | sent | overdue | paid); an overdue badge says for how long
export default function InvoiceStatusBadge({ status, daysOverdue = 0 }) {
  const { tone, label } = STATUS[status] ?? STATUS.draft;
  const text = status === 'overdue' && daysOverdue > 0 ? `${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue` : label;
  return <Badge tone={tone}>{text}</Badge>;
}
