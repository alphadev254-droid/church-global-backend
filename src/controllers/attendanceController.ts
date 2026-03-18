import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';

const schema = z.object({
  date: z.string().min(1, 'Date required'),
  totalAttendees: z.number().int().positive(),
  maleCount: z.number().int().min(0).default(0),
  femaleCount: z.number().int().min(0).default(0),
  children: z.number().int().min(0).default(0),
  youth: z.number().int().min(0).default(0),
  youngAdults: z.number().int().min(0).default(0),
  adults: z.number().int().min(0).default(0),
  seniors: z.number().int().min(0).default(0),
  newVisitors: z.number().int().min(0).default(0),
  serviceType: z.string().default('Sunday Service'),
  notes: z.string().optional(),
  eventId: z.string().optional(),
  churchId: z.string().min(1, 'Church ID required'),
});

export async function getAttendance(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role ?? 'member';
  const { churchId: filterChurchId, serviceType, startDate, endDate } = req.query;
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Use getAccessibleChurchIds for all roles
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (accessibleChurchIds.length === 0) {
    res.json({ success: true, data: [] });
    return;
  }

  const whereClause: any = { churchId: { in: accessibleChurchIds } };
  
  // Apply filters
  if (filterChurchId && typeof filterChurchId === 'string') {
    // Ensure the filtered church is in accessible churches
    if (accessibleChurchIds.includes(filterChurchId)) {
      whereClause.churchId = filterChurchId;
    } else {
      // User doesn't have access to this church
      res.json({ success: true, data: [] });
      return;
    }
  }
  if (serviceType && typeof serviceType === 'string') {
    whereClause.serviceType = serviceType;
  }
  if (startDate && typeof startDate === 'string') {
    whereClause.date = { ...whereClause.date, gte: new Date(startDate) };
  }
  if (endDate && typeof endDate === 'string') {
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999); // Include the entire end date
    whereClause.date = { ...whereClause.date, lte: endDateTime };
  }

  const records = await prisma.attendance.findMany({
    where: whereClause,
    include: {
      church: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { date: 'desc' },
    take: 100,
  });
  
  res.json({ success: true, data: records });
}

export async function createAttendance(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role;
  
  // Check if user has attendance_tracking feature
  const { hasFeature } = await import('../lib/packageChecker');
  if (!(await hasFeature(userId!, 'attendance_tracking'))) {
    res.status(403).json({ success: false, message: 'Your package does not include Attendance Tracking. Please upgrade to access this feature.' });
    return;
  }
  
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { churchId: targetChurchId, eventId, ...data } = parsed.data;

  // Verify user has access to this church
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (!accessibleChurchIds.includes(targetChurchId)) {
    res.status(403).json({ success: false, message: 'Access denied to this church' });
    return;
  }

  const attendanceDate = new Date(data.date);
  const dateOnly = new Date(attendanceDate.getFullYear(), attendanceDate.getMonth(), attendanceDate.getDate());

  // For event attendance, check if record exists for same event and date
  if (eventId) {
    const existing = await prisma.attendance.findFirst({
      where: {
        eventId,
        churchId: targetChurchId,
        date: {
          gte: dateOnly,
          lt: new Date(dateOnly.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    if (existing) {
      // Update existing record
      const updated = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          totalAttendees: data.totalAttendees,
          maleCount: data.maleCount,
          femaleCount: data.femaleCount,
          children: data.children,
          youth: data.youth,
          youngAdults: data.youngAdults,
          adults: data.adults,
          seniors: data.seniors,
          newVisitors: data.newVisitors,
          notes: data.notes,
        },
      });
      res.json({ success: true, data: updated, updated: true });
      return;
    }
  }

  // Create new record
  const record = await prisma.attendance.create({
    data: {
      ...data,
      churchId: targetChurchId,
      eventId,
      date: attendanceDate,
    },
  });
  
  res.status(201).json({ success: true, data: record });
}

export async function updateAttendance(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role;
  const id = req.params.id as string;

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { churchId: targetChurchId, eventId, ...data } = parsed.data;

  const record = await prisma.attendance.findUnique({ where: { id }, include: { church: true } });
  if (!record) {
    res.status(404).json({ success: false, message: 'Record not found' });
    return;
  }

  // Verify user has access
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (!accessibleChurchIds.includes(record.churchId)) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return;
  }

  const updated = await prisma.attendance.update({
    where: { id },
    data: {
      ...data,
      date: new Date(data.date),
      churchId: targetChurchId,
      eventId,
    },
  });

  res.json({ success: true, data: updated });
}

export async function deleteAttendance(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role;
  const id = String(req.params.id);

  const record = await prisma.attendance.findUnique({ where: { id }, include: { church: true } });
  if (!record) {
    res.status(404).json({ success: false, message: 'Record not found' });
    return;
  }

  // Verify user has access to delete
  const accessibleChurchIds = await getAccessibleChurchIds(
    roleName!,
    churchId,
    req.user?.districts,
    req.user?.traditionalAuthorities,
    req.user?.regions,
    userId
  );

  if (!accessibleChurchIds.includes(record.churchId)) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return;
  }

  await prisma.attendance.delete({ where: { id } });
  res.json({ success: true, message: 'Record deleted' });
}
