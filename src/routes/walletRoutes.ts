import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getWalletBalance,
  getWalletTransactions,
  requestWithdrawal,
  getWithdrawals
} from '../controllers/walletController';

const router = Router();

router.get('/balance', authenticate, getWalletBalance);
router.get('/transactions', authenticate, getWalletTransactions);
router.post('/withdraw', authenticate, requestWithdrawal);
router.get('/withdrawals', authenticate, getWithdrawals);

export default router;
