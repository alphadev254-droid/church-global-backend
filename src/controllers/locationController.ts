import { Request, Response } from 'express';
import prisma from '../lib/prisma';

export async function getRegions(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Get user's country
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true, churchId: true }
  });

  let country = user?.accountCountry;

  // If user doesn't have accountCountry, get it from their national admin
  if (!country && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    country = ministryAdmin?.accountCountry;
  }

  // If still no country and user is a member, get it from church's national admin
  if (!country && user?.churchId) {
    const church = await prisma.church.findUnique({
      where: { id: user.churchId },
      select: { ministryAdminId: true }
    });
    if (church?.ministryAdminId) {
      const ministryAdmin = await prisma.user.findUnique({
        where: { id: church.ministryAdminId },
        select: { accountCountry: true }
      });
      country = ministryAdmin?.accountCountry;
    }
  }

  // Return empty array if no country found
  if (!country) {
    res.json({ success: true, data: [] });
    return;
  }

  const regions = await prisma.location.findMany({
    where: { country },
    select: { region: true },
    distinct: ['region'],
    orderBy: { region: 'asc' }
  });
  res.json({ success: true, data: regions.map(r => r.region) });
}

export async function getDistricts(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const region = String(req.params.region);
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Get user's country
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true, churchId: true }
  });

  let country = user?.accountCountry;

  // If user doesn't have accountCountry, get it from their national admin
  if (!country && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    country = ministryAdmin?.accountCountry;
  }

  // If still no country and user is a member, get it from church's national admin
  if (!country && user?.churchId) {
    const church = await prisma.church.findUnique({
      where: { id: user.churchId },
      select: { ministryAdminId: true }
    });
    if (church?.ministryAdminId) {
      const ministryAdmin = await prisma.user.findUnique({
        where: { id: church.ministryAdminId },
        select: { accountCountry: true }
      });
      country = ministryAdmin?.accountCountry;
    }
  }

  // Default to Malawi if no country found
  if (!country) {
    country = 'Malawi';
  }

  const districts = await prisma.location.findMany({
    where: { country, region },
    select: { district: true },
    distinct: ['district'],
    orderBy: { district: 'asc' }
  });
  res.json({ success: true, data: districts.map(d => d.district) });
}

export async function getTraditionalAuthorities(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const region = String(req.params.region);
  const district = String(req.params.district);
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Get user's country
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true, churchId: true }
  });

  let country = user?.accountCountry;

  // If user doesn't have accountCountry, get it from their national admin
  if (!country && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    country = ministryAdmin?.accountCountry;
  }

  // If still no country and user is a member, get it from church's national admin
  if (!country && user?.churchId) {
    const church = await prisma.church.findUnique({
      where: { id: user.churchId },
      select: { ministryAdminId: true }
    });
    if (church?.ministryAdminId) {
      const ministryAdmin = await prisma.user.findUnique({
        where: { id: church.ministryAdminId },
        select: { accountCountry: true }
      });
      country = ministryAdmin?.accountCountry;
    }
  }

  // Default to Malawi if no country found
  if (!country) {
    country = 'Malawi';
  }

  const tas = await prisma.location.findMany({
    where: { country, region, district },
    select: { traditionalAuthority: true },
    distinct: ['traditionalAuthority'],
    orderBy: { traditionalAuthority: 'asc' }
  });
  res.json({ success: true, data: tas.map(ta => ta.traditionalAuthority) });
}

export async function getVillages(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const region = String(req.params.region);
  const district = String(req.params.district);
  const traditionalAuthority = String(req.params.traditionalAuthority);
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Get user's country
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true, churchId: true }
  });

  let country = user?.accountCountry;

  // If user doesn't have accountCountry, get it from their national admin
  if (!country && user?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    country = ministryAdmin?.accountCountry;
  }

  // If still no country and user is a member, get it from church's national admin
  if (!country && user?.churchId) {
    const church = await prisma.church.findUnique({
      where: { id: user.churchId },
      select: { ministryAdminId: true }
    });
    if (church?.ministryAdminId) {
      const ministryAdmin = await prisma.user.findUnique({
        where: { id: church.ministryAdminId },
        select: { accountCountry: true }
      });
      country = ministryAdmin?.accountCountry;
    }
  }

  // Default to Malawi if no country found
  if (!country) {
    country = 'Malawi';
  }

  const villages = await prisma.location.findMany({
    where: { country, region, district, traditionalAuthority },
    select: { village: true },
    distinct: ['village'],
    orderBy: { village: 'asc' }
  });
  res.json({ success: true, data: villages.map(v => v.village).filter(v => v !== '') });
}
