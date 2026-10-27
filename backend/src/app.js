import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import clientRoutes from './routes/client.routes.js';
import projectRoutes from './routes/project.routes.js';
import timerRoutes from './routes/timer.routes.js';
import entryRoutes from './routes/entry.routes.js';
import timesheetRoutes from './routes/timesheet.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

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

app.use(notFound);
app.use(errorHandler);

export default app;
