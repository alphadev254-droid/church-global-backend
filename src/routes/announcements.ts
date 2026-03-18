import { Router } from 'express';
import { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '../controllers/announcementController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/',       authorizePermission('communication:read'),   getAnnouncements);
router.post('/',      authorizePermission('communication:create'), createAnnouncement);
router.put('/:id',    authorizePermission('communication:update'), updateAnnouncement);
router.delete('/:id', authorizePermission('communication:delete'), deleteAnnouncement);

export default router;
