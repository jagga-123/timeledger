import PageHeader from '../components/PageHeader';
import { useAuth } from '../hooks/useAuth';

// Placeholder: the real dashboard comes in a later step
export default function Dashboard() {
  const { user } = useAuth();

  return <PageHeader title="Dashboard" description={`Welcome, ${user.name}`} />;
}
