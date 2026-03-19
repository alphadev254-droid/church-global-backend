import { Router } from 'express';
import { mpesaCallback, mpesaIpWhitelist } from '../controllers/mpesaCallbackController';
import {
  handleB2CResult,
  handleB2BResult,
  handleB2CTimeout,
  handleB2BTimeout,
} from '../controllers/nationalAdminWalletController';

const router = Router();

// M-Pesa STK push callback — IP-whitelisted, Safaricom only
router.post('/payments/callback', mpesaIpWhitelist, mpesaCallback);

// M-Pesa B2C / B2B result & timeout callbacks
router.post('/payments/b2c-result',  handleB2CResult);
router.post('/payments/b2b-result',  handleB2BResult);
router.post('/payments/b2c-timeout', handleB2CTimeout);
router.post('/payments/b2b-timeout', handleB2BTimeout);

export default router;
