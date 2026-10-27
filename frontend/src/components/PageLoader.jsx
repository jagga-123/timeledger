import { Loader2 } from 'lucide-react';

// Full screen by default; pass `compact` to use it inside a page
export default function PageLoader({ compact = false }) {
  return (
    <div className={`flex items-center justify-center ${compact ? 'py-16' : 'min-h-screen'}`}>
      <Loader2 size={32} className="animate-spin text-primary" />
    </div>
  );
}
