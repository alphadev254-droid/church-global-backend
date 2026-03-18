import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import * as subaccountController from '../controllers/subaccountController';

const router = Router();

router.post('/', authenticate, authorizePermission('subaccounts:create'), subaccountController.createSubaccount);
router.put('/:id', authenticate, authorizePermission('subaccounts:update'), subaccountController.updateSubaccount);
router.get('/church/:churchId', authenticate, authorizePermission('subaccounts:view'), subaccountController.getSubaccount);
router.get('/banks', authenticate, subaccountController.getBanks);

export default router;
