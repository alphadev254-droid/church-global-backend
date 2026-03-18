import { Router } from 'express';
import { getStats } from '../controllers/dashboardController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/stats', authorizePermission('dashboard:read'), getStats);

export default router;
