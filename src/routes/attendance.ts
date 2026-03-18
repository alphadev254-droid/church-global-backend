import { Router } from 'express';
import { getAttendance, createAttendance, updateAttendance, deleteAttendance } from '../controllers/attendanceController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/',       authorizePermission('attendance:read'),   getAttendance);
router.post('/',      authorizePermission('attendance:create'), createAttendance);
router.put('/:id',    authorizePermission('attendance:update'), updateAttendance);
router.delete('/:id', authorizePermission('attendance:update'), deleteAttendance);

export default router;
