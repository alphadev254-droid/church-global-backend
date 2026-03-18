import { Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';
import { groupByDateRanges } from '../lib/dateGrouping';

type StoredFile = { url: string; name: string; size: number; mimeType: string };

function deleteUploadedFile(url: string) {
  if (url.startsWith('/uploads/')) {
    const p = path.join(process.cwd(), url.replace(/^\//,''));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function parseStoredFiles(json: unknown): StoredFile[] {
  if (!json) return [];
  try { return JSON.parse(json as string) as StoredFile[]; } catch { return []; }
}

// ─── GET /api/resources ───────────────────────────────────────────────────────

export async function getResources(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId ?? '';
  const roleName = req.user?.role ?? 'member';
  
  const filterChurchId = req.query.churchId as string | undefined;
  const filterCategory = req.query.category as string | undefined;
  
  const churchIds = await getAccessibleChurchIds(
    roleName, 
    churchId, 
    req.user?.districts, 
    req.user?.traditionalAuthorities, 
    req.user?.regions, 
    userId
  );
  
  const whereClause: any = { churchId: { in: churchIds } };
  
  // Apply church filter if provided
  if (filterChurchId) {
    // Verify user has access to this church
    if (!churchIds.includes(filterChurchId)) {
      res.status(403).json({ success: false, message: 'Access denied to this church' });
      return;
    }
    whereClause.churchId = filterChurchId;
  }
  
  // Apply category filter if provided
  if (filterCategory && filterCategory !== 'all') {
    whereClause.category = filterCategory;
  }
  
  const resources = await prisma.resource.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });
  
  // Group by date ranges
  const grouped = groupByDateRanges(resources);
  
  res.json({ success: true, data: grouped });
}

// ─── POST /api/resources ──────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().min(1, 'Title required'),
  description: z.string().optional(),
  category: z.enum(['bible', 'devotional', 'study_plan', 'sermon', 'worship', 'general']).default('general'),
  type: z.enum(['article', 'video', 'audio', 'document', 'link']).default('document'),
  author: z.string().optional(),
  duration: z.string().optional(),
  tags: z.string().optional(),
  fileUrl: z.string().optional(),
  churchId: z.string().min(1, 'Church ID required'),
});

export async function createResource(req: Request, res: Response): Promise<void> {
  const createdById = req.user?.userId;
  if (!createdById) { res.status(401).json({ success: false, message: 'Not authenticated' }); return; }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.errors[0].message }); return; }

  const { title, description, category, type, author, duration, tags, fileUrl, churchId } = parsed.data;
  const files = ((req as any).files as Express.Multer.File[] | undefined) ?? [];
  const primaryFile = files[0];
  const resolvedFileUrl = primaryFile ? `/uploads/resources/${primaryFile.filename}` : fileUrl;
  const filesJson = files.length > 0
    ? JSON.stringify(files.map(f => ({ url: `/uploads/resources/${f.filename}`, name: f.originalname, size: f.size, mimeType: f.mimetype })))
    : undefined;

  const resource = await prisma.resource.create({
    data: {
      title, description, category, type, author, duration, tags,
      fileUrl: resolvedFileUrl,
      fileName: primaryFile?.originalname,
      fileSize: primaryFile?.size,
      mimeType: primaryFile?.mimetype,
      filesJson,
      churchId, createdById,
    } as any,
  });
  res.status(201).json({ success: true, data: resource });
}

// ─── PUT /api/resources/:id ───────────────────────────────────────────────────

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.enum(['bible', 'devotional', 'study_plan', 'sermon', 'worship', 'general']).optional(),
  type: z.enum(['article', 'video', 'audio', 'document', 'link']).optional(),
  author: z.string().optional(),
  duration: z.string().optional(),
  tags: z.string().optional(),
  fileUrl: z.string().optional(),
});

export async function updateResource(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId ?? '';
  const roleName = req.user?.role ?? 'member';

  const resource = await prisma.resource.findUnique({ where: { id: String(req.params.id) } });
  if (!resource) { res.status(404).json({ success: false, message: 'Resource not found' }); return; }

  const accessibleIds = await getAccessibleChurchIds(
    roleName, 
    churchId, 
    req.user?.districts, 
    req.user?.traditionalAuthorities, 
    req.user?.regions, 
    userId
  );
  if (!accessibleIds.includes(resource.churchId)) {
    res.status(403).json({ success: false, message: 'Access denied' }); return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.errors[0].message }); return; }

  const newUploads = ((req as any).files as Express.Multer.File[] | undefined) ?? [];

  // keepFilesJson: JSON string of URL array the client wants to keep (sent from edit form)
  const keepFilesJsonRaw = req.body.keepFilesJson as string | undefined;

  const updateData: Record<string, unknown> = { ...parsed.data };

  if (keepFilesJsonRaw !== undefined || newUploads.length > 0) {
    // Load current stored files (support old single-file + new multi-file resources)
    let existingFiles: StoredFile[] = parseStoredFiles((resource as any).filesJson);
    if (existingFiles.length === 0 && resource.fileUrl?.startsWith('/uploads/') && resource.fileName) {
      existingFiles = [{ url: resource.fileUrl, name: resource.fileName, size: resource.fileSize ?? 0, mimeType: resource.mimeType ?? '' }];
    }

    // Determine which existing files to keep
    let keptFiles = existingFiles;
    if (keepFilesJsonRaw !== undefined) {
      let keepUrls: string[] = [];
      try { keepUrls = JSON.parse(keepFilesJsonRaw); } catch { keepUrls = []; }
      // Delete physical files that are being removed
      for (const f of existingFiles) {
        if (!keepUrls.includes(f.url)) deleteUploadedFile(f.url);
      }
      keptFiles = existingFiles.filter(f => keepUrls.includes(f.url));
    }

    // Append newly uploaded files
    const uploadedEntries: StoredFile[] = newUploads.map(f => ({
      url: `/uploads/resources/${f.filename}`,
      name: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));
    const allFiles = [...keptFiles, ...uploadedEntries];

    updateData.filesJson = allFiles.length > 0 ? JSON.stringify(allFiles) : null;

    if (allFiles.length > 0) {
      updateData.fileUrl  = allFiles[0].url;
      updateData.fileName = allFiles[0].name;
      updateData.fileSize = allFiles[0].size;
      updateData.mimeType = allFiles[0].mimeType;
    } else {
      updateData.fileUrl = parsed.data.fileUrl ?? null; // keep manual URL if provided
      updateData.fileName = null;
      updateData.fileSize = null;
      updateData.mimeType = null;
    }
  }

  const updated = await prisma.resource.update({ where: { id: String(req.params.id) }, data: updateData });
  res.json({ success: true, data: updated });
}

// ─── DELETE /api/resources/:id ────────────────────────────────────────────────

export async function deleteResource(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId ?? '';
  const roleName = req.user?.role ?? 'member';

  const resource = await prisma.resource.findUnique({ where: { id: String(req.params.id) } });
  if (!resource) { res.status(404).json({ success: false, message: 'Resource not found' }); return; }

  const accessibleIds = await getAccessibleChurchIds(
    roleName, 
    churchId, 
    req.user?.districts, 
    req.user?.traditionalAuthorities, 
    req.user?.regions, 
    userId
  );
  if (!accessibleIds.includes(resource.churchId)) {
    res.status(403).json({ success: false, message: 'Access denied' }); return;
  }

  // Delete all physical files
  if (resource.fileUrl) deleteUploadedFile(resource.fileUrl);
  for (const f of parseStoredFiles((resource as any).filesJson)) deleteUploadedFile(f.url);

  await prisma.resource.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, message: 'Resource deleted' });
}
