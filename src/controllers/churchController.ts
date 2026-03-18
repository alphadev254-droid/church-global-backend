import { Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';

export async function getChurches(req: Request, res: Response): Promise<void> {
  const role = req.user?.role ?? 'member';
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;

  let churchIds: string[] = [];

  if (role === 'ministry_admin' && userId) {
    // National admin sees churches they own
    const churches = await prisma.church.findMany({
      where: { ministryAdminId: userId },
      select: { id: true }
    });
    churchIds = churches.map(c => c.id);
  } else {
    // Other roles use existing scope logic
    churchIds = await getAccessibleChurchIds(
      role,
      churchId ?? '',
      req.user?.districts,
      req.user?.traditionalAuthorities,
      req.user?.regions,
      userId
    );
  }

  const memberRole = await prisma.role.findUnique({ where: { name: 'member' }, select: { id: true } });
  
  const allChurches = await prisma.church.findMany({
    where: { id: { in: churchIds } },
    orderBy: { name: 'asc' },
  });
  
  const churchesWithCounts = await Promise.all(allChurches.map(async (church) => {
    const memberCount = await prisma.user.count({
      where: { churchId: church.id, roleId: memberRole?.id }
    });
    return { ...church, memberCount };
  }));

  res.json({ success: true, data: churchesWithCounts });
}

export async function getChurch(req: Request, res: Response): Promise<void> {
  const memberRole = await prisma.role.findUnique({ where: { name: 'member' }, select: { id: true } });
  
  const church = await prisma.church.findUnique({
    where: { id: String(req.params.id) },
  });
  if (!church) { res.status(404).json({ success: false, message: 'Church not found' }); return; }
  
  const memberCount = await prisma.user.count({
    where: { churchId: church.id, roleId: memberRole?.id }
  });
  
  res.json({ success: true, data: { ...church, memberCount } });
}

// ─── POST /api/churches ───────────────────────────────────────────────────────

const churchSchema = z.object({
  name: z.string().min(2, 'Name required'),
  location: z.string().optional(),
  country: z.string().default('Malawi'),
  region: z.string().min(1, 'Region is required'),
  district: z.string().min(1, 'District is required'),
  traditionalAuthority: z.string().min(1, 'Traditional Authority is required'),
  village: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().optional(),
  pastorName: z.string().optional(),
  yearFounded: z.coerce.number().int().positive().optional(),
});

export async function createChurch(req: Request, res: Response): Promise<void> {
  const adminUserId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  if (!adminUserId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Check if user has churches_management feature
  const { hasFeature, checkLimit } = await import('../lib/packageChecker');
  
  if (!(await hasFeature(adminUserId, 'churches_management'))) {
    res.status(403).json({ 
      success: false, 
      message: 'Churches management is not available in your package. Please upgrade to access this feature.',
      featureRequired: 'churches_management'
    });
    return;
  }

  const parsed = churchSchema.safeParse(req.body);
  if (!parsed.success) { 
    res.status(400).json({ success: false, message: parsed.error.errors[0].message }); 
    return; 
  }

  const adminUser = await prisma.user.findUnique({
    where: { id: adminUserId },
    include: { ownedChurches: true }
  });

  if (!adminUser) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  if (role !== 'ministry_admin') {
    res.status(403).json({ success: false, message: 'Only national admins can create churches' });
    return;
  }

  // Check max_churches limit
  const currentChurchCount = adminUser.ownedChurches.length;
  const limitCheck = await checkLimit(adminUserId, 'max_churches', currentChurchCount);
  
  if (!limitCheck.allowed) {
    res.status(403).json({ 
      success: false, 
      message: limitCheck.message || 'Church limit reached',
      limit: limitCheck.limit
    });
    return;
  }

  const { name, country, region, district, traditionalAuthority, village, address, phone, email, website, pastorName, yearFounded } = parsed.data;

  // Build location string
  const locParts = [traditionalAuthority, district, region].filter(Boolean);
  const location = parsed.data.location || locParts.join(', ') || 'Malawi';

  const branchCode = `${name.replace(/\s+/g, '').substring(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  // Handle logo upload
  const logoUrl = req.file ? `/uploads/churches/${req.file.filename}` : undefined;

  const church = await prisma.church.create({
    data: {
      name, location, country,
      region, district, traditionalAuthority, village,
      address, phone, email: email || undefined, website, pastorName, yearFounded,
      branchCode,
      logoUrl,
      ministryAdminId: adminUserId,
    },
    include: { _count: { select: { users: true } } },
  });

  res.status(201).json({ success: true, data: church });
}

// ─── PUT /api/churches/:id ────────────────────────────────────────────────────

const updateChurchSchema = z.object({
  name: z.string().min(2, 'Name required').optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  region: z.string().min(1, 'Region is required').optional(),
  district: z.string().min(1, 'District is required').optional(),
  traditionalAuthority: z.string().min(1, 'Traditional Authority is required').optional(),
  village: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().optional(),
  pastorName: z.string().optional(),
  yearFounded: z.coerce.number().int().positive().optional(),
});

export async function updateChurch(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  
  if (!userId) { 
    res.status(401).json({ success: false, message: 'Not authenticated' }); 
    return; 
  }

  const church = await prisma.church.findUnique({ where: { id: String(req.params.id) } });
  if (!church) { 
    res.status(404).json({ success: false, message: 'Church not found' }); 
    return; 
  }

  // Check access permissions
  let hasAccess = false;
  
  if (role === 'ministry_admin') {
    // National admin can update churches they own
    hasAccess = church.ministryAdminId === userId;
  } else {
    // Other roles use the existing scope logic
    const churchId = req.user?.churchId;
    if (!churchId) {
      res.status(401).json({ success: false, message: 'Church ID required for this role' });
      return;
    }
    
    const churchIds = await getAccessibleChurchIds(
      role,
      churchId,
      req.user?.districts,
      req.user?.traditionalAuthorities,
      req.user?.regions,
      userId
    );
    hasAccess = churchIds.includes(church.id);
  }
  
  if (!hasAccess) { 
    res.status(403).json({ success: false, message: 'Access denied' }); 
    return; 
  }

  const parsed = updateChurchSchema.safeParse(req.body);
  if (!parsed.success) { 
    res.status(400).json({ success: false, message: parsed.error.errors[0].message }); 
    return; 
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (updateData.email === '') updateData.email = null;

  // Handle logo: new upload takes priority, then removeLogo flag, otherwise leave unchanged
  if (req.file) {
    // Delete old logo file if it exists
    if (church.logoUrl) {
      const oldPath = path.join(process.cwd(), church.logoUrl.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    updateData.logoUrl = `/uploads/churches/${req.file.filename}`;
  } else if (req.body.removeLogo === 'true') {
    // User explicitly removed the logo — delete file and clear DB field
    if (church.logoUrl) {
      const oldPath = path.join(process.cwd(), church.logoUrl.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    updateData.logoUrl = null;
  }

  const updated = await prisma.church.update({
    where: { id: String(req.params.id) },
    data: updateData,
    include: { _count: { select: { users: true } } },
  });

  res.json({ success: true, data: updated });
}

// ─── GET /api/churches/by-invite/:token ──────────────────────────────────────

export async function getChurchByInvite(req: Request, res: Response): Promise<void> {
  const inviteToken = String(req.params.token);
  
  if (!inviteToken) {
    res.status(400).json({ success: false, message: 'Invite token required' });
    return;
  }

  const church = await prisma.church.findUnique({
    where: { inviteToken },
    select: { id: true, name: true, location: true, logoUrl: true }
  });

  if (!church) {
    res.status(404).json({ success: false, message: 'Invalid or expired invite link' });
    return;
  }

  res.json({ success: true, data: church });
}

// ─── POST /api/churches/:id/generate-invite ──────────────────────────────────

export async function generateInviteLink(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const role = req.user?.role ?? 'member';
  
  if (!userId) { 
    res.status(401).json({ success: false, message: 'Not authenticated' }); 
    return; 
  }

  const church = await prisma.church.findUnique({ where: { id: String(req.params.id) } });
  if (!church) { 
    res.status(404).json({ success: false, message: 'Church not found' }); 
    return; 
  }

  // Check access permissions using getAccessibleChurchIds
  const accessibleChurchIds = await getAccessibleChurchIds(
    role,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );
  
  if (!accessibleChurchIds.includes(church.id)) { 
    res.status(403).json({ success: false, message: 'Access denied' }); 
    return; 
  }

  // Generate unique token
  const crypto = await import('crypto');
  const inviteToken = crypto.randomBytes(16).toString('hex');

  const updated = await prisma.church.update({
    where: { id: church.id },
    data: { inviteToken },
    select: { id: true, name: true, inviteToken: true },
  });

  res.json({ success: true, data: updated });
}

// ─── DELETE /api/churches/:id ─────────────────────────────────────────────────

export async function deleteChurch(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  
  if (!userId) { 
    res.status(401).json({ success: false, message: 'Not authenticated' }); 
    return; 
  }

  const church = await prisma.church.findUnique({ where: { id: String(req.params.id) } });
  if (!church) { 
    res.status(404).json({ success: false, message: 'Church not found' }); 
    return; 
  }

  // Check access permissions
  let hasAccess = false;
  
  if (role === 'ministry_admin') {
    // National admin can delete churches they own
    hasAccess = church.ministryAdminId === userId;
  } else {
    // Other roles use the existing scope logic
    const churchId = req.user?.churchId;
    if (!churchId) {
      res.status(401).json({ success: false, message: 'Church ID required for this role' });
      return;
    }
    
    const churchIds = await getAccessibleChurchIds(
      role,
      churchId,
      req.user?.districts,
      req.user?.traditionalAuthorities,
      req.user?.regions,
      userId
    );
    hasAccess = churchIds.includes(church.id);
  }
  
  if (!hasAccess) { 
    res.status(403).json({ success: false, message: 'Access denied' }); 
    return; 
  }

  // Delete logo file if exists
  if (church.logoUrl) {
    const logoPath = path.join(process.cwd(), church.logoUrl.replace(/^\//, ''));
    if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
  }

  // Delete related records first to avoid foreign key constraint violations
  await prisma.$transaction(async (tx) => {
    // Delete all related records
    await tx.event.deleteMany({ where: { churchId: church.id } });
    await tx.givingCampaign.deleteMany({ where: { churchId: church.id } });
    await tx.donationTransaction.deleteMany({ where: { churchId: church.id } });
    await tx.attendance.deleteMany({ where: { churchId: church.id } });
    await tx.meeting.deleteMany({ where: { churchId: church.id } });
    await tx.announcement.deleteMany({ where: { churchId: church.id } });
    await tx.resource.deleteMany({ where: { churchId: church.id } });
    // Payment model uses ministryAdminId, not churchId
    await tx.payment.deleteMany({ where: { ministryAdminId: church.ministryAdminId || undefined } });
    await tx.transaction.deleteMany({ where: { churchId: church.id } });
    
    // Update users to remove church association (but don't delete the users)
    await tx.user.updateMany({ 
      where: { churchId: church.id }, 
      data: { churchId: null } 
    });
    
    // Finally delete the church
    await tx.church.delete({ where: { id: church.id } });
  });
  
  res.json({ success: true, message: 'Church deleted successfully' });
}
