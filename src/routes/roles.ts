import { Router } from 'express';
import { getRoles, getAllPermissions, updateRolePermissions, assignRole } from '../controllers/rolesController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// List all roles for current church (with their permissions + user counts)
router.get('/', authorizePermission('roles:read'), getRoles);

// List all available permission definitions
router.get('/permissions', authorizePermission('roles:read'), getAllPermissions);

// Update which permissions a role has (transfer/assign power)
router.put('/:id/permissions', authorizePermission('roles:manage'), updateRolePermissions);

// Assign a role to a user
router.post('/assign', authorizePermission('roles:assign'), assignRole);

export default router;
