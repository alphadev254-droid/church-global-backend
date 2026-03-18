import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizePermission } from '../middleware/auth';
import {
  getPackages, getCurrentPackage,
  getFeatures, createFeature, deleteFeature,
  setPackageFeatures,
  calculateFees,
  getPayments, createPayment, updatePayment,
} from '../controllers/packageController';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── Package tiers ────────────────────────────────────────────────────────────
router.get('/',                getPackages);
router.get('/current',         getCurrentPackage);
router.get('/calculate-fees',  calculateFees);

// ─── Package features (manage which features each package includes) ───────────
router.get('/features',           getFeatures);  // Public - no permission needed
router.post('/features',          authorizePermission('packages:manage'), createFeature);
router.delete('/features/:id',    authorizePermission('packages:manage'), deleteFeature);
router.put('/:id/features',       authorizePermission('packages:manage'), setPackageFeatures);

// ─── Payments ─────────────────────────────────────────────────────────────────
router.get('/payments',           authorizePermission('system_payments:view'), getPayments);
router.post('/payments',          authorizePermission('payments:create'), createPayment);
router.put('/payments/:id',       authorizePermission('payments:create'), updatePayment);

export default router;
