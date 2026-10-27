import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import api from './api/axios';

export default function App() {
  const [status, setStatus] = useState('checking...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get('/health')
      .then((res) => setStatus(res.data.status))
      .catch(() => {
        setStatus('unreachable');
        setFailed(true);
      });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <div className="flex items-center gap-2 text-primary">
        <Clock size={32} />
        <h1 className="text-3xl font-bold">TimeLedger</h1>
      </div>
      <p className="text-slate-600">
        API status:{' '}
        <span
          className={`font-mono font-medium ${failed ? 'text-red-500' : 'text-success'}`}
        >
          {status}
        </span>
      </p>
    </main>
  );
}
