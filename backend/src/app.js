import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import clientRoutes from './routes/client.routes.js';
import projectRoutes from './routes/project.routes.js';
import timerRoutes from './routes/timer.routes.js';
import entryRoutes from './routes/entry.routes.js';
import timesheetRoutes from './routes/timesheet.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import publicRoutes from './routes/public.routes.js';
import cronRoutes from './routes/cron.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

// The app runs behind ONE proxy or load balancer (Render, Heroku, nginx, ...), which puts the visitor's address in
// X-Forwarded-For. Without this, every visitor would look like the proxy to the rate limit on the public invoice
// link (one shared allowance for everybody). With 1, only the entry the proxy added is believed, so a visitor can't
// fake their address by sending their own X-Forwarded-For. Run it with no proxy in front and that header could be faked.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/timer', timerRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/timesheet', timesheetRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/public', publicRoutes); // no login: see routes/public.routes.js
app.use('/api/cron', cronRoutes); // no login, a shared secret instead: see middleware/cronSecret.js

app.use(notFound);
app.use(errorHandler);

export default app;
