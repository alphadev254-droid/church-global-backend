import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { getUsers, createUser, updateUser, deleteUser, bulkCreateUsers } from '../controllers/userController';

const router = Router();
router.use(authenticate);

router.get('/',      authorizePermission('users:read'),   getUsers);
router.post('/',     authorizePermission('users:create'), createUser);
router.post('/bulk', authorizePermission('users:create'), bulkCreateUsers);
router.put('/:id',   authorizePermission('users:update'), updateUser);
router.delete('/:id', authorizePermission('users:delete'), deleteUser);

export default router;
