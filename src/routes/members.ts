import { Router } from 'express';
import { getMembers, getMember, createMember, updateMember, deleteMember } from '../controllers/memberController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/',       authorizePermission('members:read'),   getMembers);
router.get('/:id',    authorizePermission('members:read'),   getMember);
router.post('/',      authorizePermission('members:create'), createMember);
router.put('/:id',    authorizePermission('members:update'), updateMember);
router.delete('/:id', authorizePermission('members:delete'), deleteMember);

export default router;
