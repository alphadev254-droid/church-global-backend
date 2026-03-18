import prisma from './prisma';

/**
 * Returns churchIds accessible to a user based on their role + location scope.
 *
 * ministry_admin      → churches where ministryAdminId = userId
 * regional_admin     → churches where church.region IN user.regions  (["__all__"] = all)
 * district_admin   → churches where church.district IN user.districts  (["__all__"] = all)
 * branch_admin         → churches where church.traditionalAuthority IN user.traditionalAuthorities (["__all__"] = all)
 * member              → only their own churchId (if set)
 */
export async function getAccessibleChurchIds(
  roleName: string,
  churchId: string | null | undefined,
  districts?: string[],
  traditionalAuthorities?: string[],
  regions?: string[],
  userId?: string,
): Promise<string[]> {

  if (roleName === 'ministry_admin') {
    if (userId) {
      const churches = await prisma.church.findMany({ 
        where: { ministryAdminId: userId },
        select: { id: true } 
      });
      return churches.map(c => c.id);
    }
    // Fallback to all churches if no userId provided
    const churches = await prisma.church.findMany({ select: { id: true } });
    return churches.map(c => c.id);
  }

  // Get ministryAdminId for non-ministry_admin roles
  let ministryAdminId: string | null = null;
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { ministryAdminId: true },
    });
    ministryAdminId = user?.ministryAdminId || null;
  }

  if (roleName === 'regional_admin') {
    if (!regions || regions.length === 0) return churchId ? [churchId] : [];
    const whereClause: any = { region: { in: regions } };
    if (ministryAdminId) whereClause.ministryAdminId = ministryAdminId;
    
    if (regions.includes('__all__')) {
      const churches = await prisma.church.findMany({ 
        where: ministryAdminId ? { ministryAdminId } : {},
        select: { id: true } 
      });
      return churches.map(c => c.id);
    }
    const churches = await prisma.church.findMany({
      where: whereClause,
      select: { id: true },
    });
    return churches.map(c => c.id);
  }

  if (roleName === 'district_admin') {
    if (!districts || districts.length === 0) return churchId ? [churchId] : [];
    const whereClause: any = { district: { in: districts } };
    if (ministryAdminId) whereClause.ministryAdminId = ministryAdminId;
    
    if (districts.includes('__all__')) {
      const churches = await prisma.church.findMany({ 
        where: ministryAdminId ? { ministryAdminId } : {},
        select: { id: true } 
      });
      return churches.map(c => c.id);
    }
    const churches = await prisma.church.findMany({
      where: whereClause,
      select: { id: true },
    });
    return churches.map(c => c.id);
  }

  if (roleName === 'branch_admin') {
    if (!traditionalAuthorities || traditionalAuthorities.length === 0) return churchId ? [churchId] : [];
    const whereClause: any = { traditionalAuthority: { in: traditionalAuthorities } };
    if (ministryAdminId) whereClause.ministryAdminId = ministryAdminId;
    
    if (traditionalAuthorities.includes('__all__')) {
      const churches = await prisma.church.findMany({ 
        where: ministryAdminId ? { ministryAdminId } : {},
        select: { id: true } 
      });
      return churches.map(c => c.id);
    }
    const churches = await prisma.church.findMany({
      where: whereClause,
      select: { id: true },
    });
    return churches.map(c => c.id);
  }

  // member or unknown role → own church only
  return churchId ? [churchId] : [];
}
