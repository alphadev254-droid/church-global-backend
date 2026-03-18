import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { uploadImage, uploadFiles } from '../middleware/upload';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(authenticate);

router.post('/image', (req, _res, next) => { (req as any).uploadSubDir = 'events'; next(); }, uploadImage.single('image'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file uploaded' });
    return;
  }
  const url = `/uploads/events/${req.file.filename}`;
  res.json({ success: true, url });
});

router.post('/communication', (req, _res, next) => { (req as any).uploadSubDir = 'communication'; next(); }, uploadFiles.array('files', 5), (req: Request, res: Response) => {
  if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
    res.status(400).json({ success: false, message: 'No files uploaded' });
    return;
  }
  const files = (req.files as Express.Multer.File[]).map(f => ({
    url: `/uploads/communication/${f.filename}`,
    name: f.originalname,
    size: f.size,
    mimeType: f.mimetype,
  }));
  res.json({ success: true, files });
});

router.delete('/delete', (req: Request, res: Response) => {
  const { fileUrl } = req.body;
  if (!fileUrl) {
    res.status(400).json({ success: false, message: 'File URL required' });
    return;
  }
  
  try {
    const filePath = path.join(process.cwd(), fileUrl.replace(/^\//, ''));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete file' });
  }
});

export default router;
