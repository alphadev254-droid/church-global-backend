import { Router } from 'express';
import { kpiController } from '../controllers/kpiController';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/calculate',   authorizePermission('reports:read'), kpiController.calculate);
router.post('/',           authorizePermission('reports:create'), kpiController.create);
router.get('/',            authorizePermission('reports:read'), kpiController.getAll);
router.get('/:id',         authorizePermission('reports:read'), kpiController.getById);
router.put('/:id',         authorizePermission('reports:update'), kpiController.update);
router.delete('/:id',      authorizePermission('reports:delete'), kpiController.delete);

export default router;
