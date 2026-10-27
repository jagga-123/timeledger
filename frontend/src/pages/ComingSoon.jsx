import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';

// Placeholder for pages that aren't built yet
export default function ComingSoon({ title, icon }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={icon} title="Coming soon" description={`${title} will be available in an upcoming update.`} />
    </>
  );
}
