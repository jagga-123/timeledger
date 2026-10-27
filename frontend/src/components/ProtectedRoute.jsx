import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PageLoader from './PageLoader';

// Only logged-in users can see the nested routes
export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
