import { Router } from 'express';
import { requestPasswordReset, resetPassword } from '../controllers/passwordResetController';

const router = Router();

router.post('/request', requestPasswordReset);
router.post('/reset', resetPassword);

export default router;
