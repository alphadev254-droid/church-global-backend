import { Router } from 'express';
import { login, register, logout, getMe, updateProfile } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { uploadImage } from '../middleware/upload';

const router = Router();

const setAvatarDir = (req: any, _res: any, next: any) => {
  req.uploadSubDir = 'avatars';
  next();
};

router.post('/login', login);
router.post('/register', register);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, setAvatarDir, uploadImage.single('avatar'), updateProfile);

export default router;
