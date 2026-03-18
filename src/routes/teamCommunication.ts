import { Router } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';
import { requireFeature } from '../middleware/packageCheck';
import { uploadFiles } from '../middleware/upload';
import {
  getTeamCommunications,
  createTeamCommunication,
  updateTeamCommunication,
  deleteTeamCommunication,
  getPostableTeams
} from '../controllers/teamCommunicationController';

const router = Router();

router.use(authenticate);
router.use(requireFeature('communication'));

// Middleware to set upload subdirectory
const setUploadDir = (req: any, _res: any, next: any) => {
  req.uploadSubDir = 'communication';
  next();
};

router.get('/', authorizePermission('communication:read'), getTeamCommunications);
router.get('/postable-teams', authorizePermission('communication:create'), getPostableTeams);
router.post('/', authorizePermission('communication:create'), setUploadDir, uploadFiles.array('files', 5), createTeamCommunication);
router.put('/:id', authorizePermission('communication:update'), setUploadDir, uploadFiles.array('files', 5), updateTeamCommunication);
router.delete('/:id', authorizePermission('communication:delete'), deleteTeamCommunication);

export default router;
