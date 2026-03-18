import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as reminderController from '../controllers/reminderController';

const router = Router();

router.get('/upcoming', authenticate, reminderController.getReminders);
router.get('/today', authenticate, reminderController.getTodayReminders);

export default router;
