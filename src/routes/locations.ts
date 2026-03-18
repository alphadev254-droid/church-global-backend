import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getRegions, getDistricts, getTraditionalAuthorities, getVillages } from '../controllers/locationController';

const router = Router();

router.get('/regions', authenticate, getRegions);
router.get('/districts/:region', authenticate, getDistricts);
router.get('/traditional-authorities/:region/:district', authenticate, getTraditionalAuthorities);
router.get('/villages/:region/:district/:traditionalAuthority', authenticate, getVillages);

export default router;