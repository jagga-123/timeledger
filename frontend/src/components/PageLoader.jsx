import { Loader2 } from 'lucide-react';

export default function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 size={32} className="animate-spin text-primary" />
    </div>
  );
}
