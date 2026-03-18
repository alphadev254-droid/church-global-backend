import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { requireFeature } from '../middleware/packageCheck';
import * as teamController from '../controllers/teamController';

const router = Router();

// Members can view their teams without feature gate (read-only)
router.get('/', authenticate, authorizePermission('teams:read'), teamController.getTeams);

// Admin actions require feature
router.post('/', authenticate, requireFeature('teams_management'), authorizePermission('teams:create'), teamController.createTeam);
router.put('/:id', authenticate, requireFeature('teams_management'), authorizePermission('teams:update'), teamController.updateTeam);
router.delete('/:id', authenticate, requireFeature('teams_management'), authorizePermission('teams:delete'), teamController.deleteTeam);
router.get('/:id/members', authenticate, requireFeature('teams_management'), authorizePermission('teams:read'), teamController.getTeamMembers);
router.post('/:id/members', authenticate, requireFeature('teams_management'), authorizePermission('teams:assign'), teamController.addTeamMember);
router.delete('/:id/members/:userId', authenticate, requireFeature('teams_management'), authorizePermission('teams:assign'), teamController.removeTeamMember);
router.put('/:id/members/:userId/leader', authenticate, requireFeature('teams_management'), authorizePermission('teams:assign'), teamController.updateTeamLeader);

export default router;
