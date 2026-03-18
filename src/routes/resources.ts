import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { uploadFiles } from '../middleware/upload';
import { getResources, createResource, updateResource, deleteResource } from '../controllers/resourceController';

const router = Router();
router.use(authenticate);

router.get('/',       authorizePermission('resources:read'),   getResources);
router.post('/',      authorizePermission('resources:create'), (req, _res, next) => { (req as any).uploadSubDir = 'resources'; next(); }, uploadFiles.array('files', 10), createResource);
router.put('/:id',    authorizePermission('resources:create'), (req, _res, next) => { (req as any).uploadSubDir = 'resources'; next(); }, uploadFiles.array('files', 10), updateResource);
router.delete('/:id', authorizePermission('resources:create'), deleteResource);

export default router;
