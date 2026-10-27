import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PageLoader from './PageLoader';

// Login/register pages: logged-in users are sent to the dashboard instead
export default function GuestRoute() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}
