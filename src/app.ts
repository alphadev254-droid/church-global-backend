import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import memberRoutes from './routes/members';
import eventRoutes from './routes/events';
import givingRoutes from './routes/giving';
import dashboardRoutes from './routes/dashboard';
import rolesRoutes from './routes/roles';
import attendanceRoutes from './routes/attendance';
import announcementRoutes from './routes/announcements';
import churchRoutes from './routes/churches';
import resourceRoutes from './routes/resources';
import userRoutes from './routes/users';
import locationRoutes from './routes/locations';
import packageRoutes from './routes/packages';
import transactionRoutes from './routes/transactions';
import paymentRoutes from './routes/payments';
import subaccountRoutes from './routes/subaccounts';
import uploadRoutes from './routes/upload';
import passwordResetRoutes from './routes/passwordReset';
import webhookRoutes from './routes/webhookRoutes';
import walletRoutes from './routes/walletRoutes';
import kpiRoutes from './routes/kpiRoutes';
import teamRoutes from './routes/teams';
import teamCommunicationRoutes from './routes/teamCommunication';
import reminderRoutes from './routes/reminderRoutes';
import { errorHandler } from './middleware/errorHandler';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app = express();

// ─── CORS — allow frontend origin with credentials ─────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true,   // needed for cookies
}));

// ─── Raw body capture for webhook signature verification ──────────────────
app.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }), (req, _res, next) => {
  req.rawBody = req.body as Buffer;
  req.body = JSON.parse(req.body.toString());
  next();
});

// ─── Body parsing & cookies ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Serve uploaded files ──────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/password-reset', passwordResetRoutes);
// app.use('/api/members', memberRoutes); // Deprecated - use /api/users instead
app.use('/api/events', eventRoutes);
app.use('/api/giving', givingRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/churches', churchRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/subaccounts', subaccountRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/kpis', kpiRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/team-communications', teamCommunicationRoutes);
app.use('/api/reminders', reminderRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────
app.use(errorHandler);

export default app;
