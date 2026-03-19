import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getNationalAdminBalance,
  getNationalAdminWithdrawals,
  getWithdrawalFee,
  requestNationalAdminWithdrawal,
} from '../controllers/nationalAdminWalletController';

const router = Router();

router.get('/balance', authenticate, getNationalAdminBalance);
router.get('/withdrawals', authenticate, getNationalAdminWithdrawals);
router.get('/fee', authenticate, getWithdrawalFee);
router.post('/withdraw', authenticate, requestNationalAdminWithdrawal);

export default router;
