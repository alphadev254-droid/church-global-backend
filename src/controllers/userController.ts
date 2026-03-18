import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { console } from 'inspector';

const USER_INCLUDE = {
  role: true,
  church: true,
} as const;

function safeUser(user: any) {
  const { password: _pw, ...rest } = user;
  // Parse JSON scope fields for frontend
  return {
    ...rest,
    roleName: rest.role?.name || rest.roleName,
    districts: rest.districts ? JSON.parse(rest.districts) : undefined,
    traditionalAuthorities: rest.traditionalAuthorities ? JSON.parse(rest.traditionalAuthorities) : undefined,
    regions: rest.regions ? JSON.parse(rest.regions) : undefined,
  };
}

// ─── GET /api/users ────────────────────────────────────────────────────────────

export async function getUsers(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  const churchId = req.user?.churchId;
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Pagination
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(100, parseInt(req.query.limit as string) || 100);
  const skip = (page - 1) * limit;

  // Filters
  const search = (req.query.search as string)?.trim() || '';
  const filterChurchId = req.query.churchId as string | undefined;
  const filterRole = req.query.role as string | undefined;
  const minAge = req.query.minAge ? parseInt(req.query.minAge as string) : undefined;
  const maxAge = req.query.maxAge ? parseInt(req.query.maxAge as string) : undefined;

  // Build where clause based on role
  let whereClause: any = {};

  if (role === 'ministry_admin') {
    const churches = await prisma.church.findMany({
      where: { ministryAdminId: userId },
      select: { id: true }
    });
    const churchIds = churches.map(c => c.id);
    
    whereClause.OR = [
      { churchId: { in: churchIds } },
      { ministryAdminId: userId }
    ];
  } else if (role === 'district_admin') {
    const userDistricts = req.user?.districts ?? [];
    const churches = await prisma.church.findMany({
      where: userDistricts.includes('__all__') ? {} : { district: { in: userDistricts } },
      select: { id: true }
    });
    whereClause.churchId = { in: churches.map(c => c.id) };
  } else if (role === 'branch_admin') {
    const userTAs = req.user?.traditionalAuthorities ?? [];
    const churches = await prisma.church.findMany({
      where: userTAs.includes('__all__') ? {} : { traditionalAuthority: { in: userTAs } },
      select: { id: true }
    });
    whereClause.churchId = { in: churches.map(c => c.id) };
  } else {
    if (!churchId) {
      res.status(400).json({ success: false, message: 'churchId required' });
      return;
    }
    whereClause.churchId = churchId;
  }

  // Apply filters
  if (filterChurchId) whereClause.churchId = filterChurchId;
  if (filterRole) whereClause.role = { name: filterRole };
  if (search) {
    whereClause.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { email: { contains: search } },
    ];
  }
  
  // Age filtering using date calculations
  if (minAge !== undefined || maxAge !== undefined) {
    const today = new Date();
    const ageFilters: any[] = [];
    
    if (minAge !== undefined) {
      // Max date for minimum age (born on or before this date)
      const maxDateForMinAge = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
      ageFilters.push({ dateOfBirth: { lte: maxDateForMinAge } });
    }
    
    if (maxAge !== undefined) {
      // Min date for maximum age (born on or after this date)
      const minDateForMaxAge = new Date(today.getFullYear() - maxAge - 1, today.getMonth(), today.getDate() + 1);
      ageFilters.push({ dateOfBirth: { gte: minDateForMaxAge } });
    }
    
    if (ageFilters.length > 0) {
      whereClause.AND = ageFilters;
    }
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: whereClause,
      include: { 
        role: { select: { id: true, name: true, displayName: true, createdAt: true } }, 
        church: { select: { name: true } },
        teams: {
          include: {
            team: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.user.count({ where: whereClause }),
  ]);

  res.json({ 
    success: true, 
    data: users.map(u => {
      const safeUserData = safeUser(u);
      return {
        ...safeUserData,
        teams: u.teams.map(t => t.team.name),
        // Ensure all member fields are included
        gender: u.gender,
        dateOfBirth: u.dateOfBirth,
        maritalStatus: u.maritalStatus,
        weddingDate: u.weddingDate,
        anniversary: u.anniversary,
        residentialNeighbourhood: u.residentialNeighbourhood,
        serviceInterest: u.serviceInterest,
        membershipType: u.membershipType,
        baptizedByImmersion: u.baptizedByImmersion,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}

// ─── POST /api/users — create a user in the same church ───────────────────────

const createUserSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name required'),
  lastName: z.string().min(1, 'Last name required'),
  phone: z.string().min(1, 'Phone number is required'),
  gender: z.enum(['male', 'female']).optional(),
  dateOfBirth: z.string().optional(),
  maritalStatus: z.enum(['single', 'married', 'widowed', 'divorced']).optional(),
  weddingDate: z.string().optional(),
  residentialNeighbourhood: z.string().optional(),
  membershipType: z.enum(['visitor', 'member']).optional(),
  serviceInterest: z.string().optional(),
  baptizedByImmersion: z.boolean().optional(),
  roleName: z.string().default('member'),
  districts: z.array(z.string()).optional(),
  traditionalAuthorities: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  churchId: z.string().optional(),
  region: z.string().optional(),
  district: z.string().optional(),
  traditionalAuthority: z.string().optional(),
  village: z.string().optional(),
}).refine((data) => {
  if (data.roleName === 'member') {
    if (!data.churchId) return false;
    if (!data.phone) return false;
    if (!data.dateOfBirth) return false;
    if (!data.residentialNeighbourhood) return false;
    if (!data.maritalStatus) return false;
  }
  return true;
}, {
  message: 'Church, Phone, Date of Birth, Neighbourhood, and Marital Status are required for members',
  path: ['churchId'],
});

export async function createUser(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  const permissions = req.user?.permissions ?? [];
  const userDistricts = req.user?.districts ?? [];
  const userTAs = req.user?.traditionalAuthorities ?? [];
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Check if user has permission to create users
  if (!permissions.includes('users:create')) {
    res.status(403).json({ success: false, message: 'Permission denied: users:create required' });
    return;
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { email, password, firstName, lastName, phone, gender, dateOfBirth, maritalStatus, weddingDate, residentialNeighbourhood, membershipType, serviceInterest, baptizedByImmersion, roleName, districts, traditionalAuthorities, regions, churchId, region, district, traditionalAuthority, village } = parsed.data;

  // Role restrictions: only ministry_admin can create users with roles other than 'member'
  // Additionally, prevent creation of ministry_admin role (only available at signup)
  if (roleName === 'ministry_admin') {
    res.status(403).json({ 
      success: false, 
      message: 'National admin role can only be assigned during initial signup. Please contact support.' 
    });
    return;
  }
  
  if (role !== 'ministry_admin' && roleName !== 'member') {
    res.status(403).json({ 
      success: false, 
      message: 'Only national administrators can create users with administrative roles. You can only create members.' 
    });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ success: false, message: 'Email already in use' });
    return;
  }

  // Find the global role
  const roleRecord = await prisma.role.findUnique({
    where: { name: roleName },
  });
  if (!roleRecord) {
    res.status(404).json({ success: false, message: `Role '${roleName}' not found` });
    return;
  }

  // Determine churchId based on user's role and the new user's role
  let assignedChurchId: string | null = null;
  
  if (role === 'ministry_admin') {
    if (roleName === 'member' && churchId) {
      // National admin assigning member to specific church
      assignedChurchId = churchId;
    } else {
      // Administrative roles don't need churchId initially
      assignedChurchId = null;
    }
  } else if (role === 'district_admin') {
    // District overseer creating users - find church based on location
    if (district && traditionalAuthority) {
      // Check if the selected location is within their scope
      if (!userDistricts.includes('__all__') && !userDistricts.includes(district)) {
        res.status(403).json({ success: false, message: 'You can only create users in your assigned districts' });
        return;
      }
      
      // Find church in that location
      const church = await prisma.church.findFirst({
        where: {
          district,
          traditionalAuthority,
          village: village || undefined,
        },
      });
      
      if (church) {
        assignedChurchId = church.id;
      } else {
        res.status(404).json({ success: false, message: 'No church found in the specified location' });
        return;
      }
    } else {
      res.status(400).json({ success: false, message: 'District and Traditional Authority required for user assignment' });
      return;
    }
  } else if (role === 'branch_admin') {
    // Local admin creating users - find church based on location
    if (traditionalAuthority) {
      // Check if the selected location is within their scope
      if (!userTAs.includes('__all__') && !userTAs.includes(traditionalAuthority)) {
        res.status(403).json({ success: false, message: 'You can only create users in your assigned traditional authorities' });
        return;
      }
      
      // Find church in that location
      const church = await prisma.church.findFirst({
        where: {
          traditionalAuthority,
          village: village || undefined,
        },
      });
      
      if (church) {
        assignedChurchId = church.id;
      } else {
        res.status(404).json({ success: false, message: 'No church found in the specified location' });
        return;
      }
    } else {
      res.status(400).json({ success: false, message: 'Traditional Authority required for user assignment' });
      return;
    }
  } else {
    // Other roles (regional_admin, member) use their own church
    const userChurchId = req.user?.churchId;
    if (!userChurchId) {
      res.status(400).json({ success: false, message: 'Church ID required for this role' });
      return;
    }
    assignedChurchId = userChurchId;
  }

  const hashed = await hashPassword(password);
  
  // Determine ministryAdminId for the new user
  let ministryAdminIdForNewUser: string | undefined;
  if (roleName === 'member') {
    // Members inherit ministryAdminId from creator
    if (role === 'ministry_admin') {
      ministryAdminIdForNewUser = userId;
    } else {
      // Creator is district_admin or branch_admin, use their ministryAdminId
      const creator = await prisma.user.findUnique({ where: { id: userId }, select: { ministryAdminId: true } });
      ministryAdminIdForNewUser = creator?.ministryAdminId || undefined;
    }
  } else if (roleName === 'district_admin' || roleName === 'branch_admin') {
    ministryAdminIdForNewUser = userId;
  }
  
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      firstName,
      lastName,
      phone,
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      maritalStatus,
      weddingDate: weddingDate ? new Date(weddingDate) : undefined,
      residentialNeighbourhood,
      membershipType,
      serviceInterest,
      baptizedByImmersion,
      roleId: roleRecord.id,
      churchId: assignedChurchId,
      ministryAdminId: ministryAdminIdForNewUser,
      districts: districts ? JSON.stringify(districts) : undefined,
      traditionalAuthorities: traditionalAuthorities ? JSON.stringify(traditionalAuthorities) : undefined,
      regions: regions ? JSON.stringify(regions) : undefined,
    },
    include: USER_INCLUDE,
  });

  const { queueEmail } = await import('../lib/emailQueue');
  const { userCreatedTemplate } = await import('../lib/emailTemplates');
  
  queueEmail(
    user.email,
    'Your Account Has Been Created',
    userCreatedTemplate({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password,
      churchName: user.church?.name,
      roleName: user.role?.displayName || roleName,
    }),
    'user_created'
  ).catch(err => console.error('Failed to queue user creation email:', err));

  res.status(201).json({ success: true, data: safeUser(user) });
}

// ─── PUT /api/users/:id — update user details ─────────────────────────────────

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  roleName: z.string().optional(),
  districts: z.array(z.string()).optional(),
  traditionalAuthorities: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  churchId: z.string().nullable().optional(),
  membershipType: z.enum(['visitor', 'member']).nullable().optional(),
  gender: z.enum(['male', 'female']).optional(),
  dateOfBirth: z.string().optional(),
  maritalStatus: z.enum(['single', 'married', 'widowed', 'divorced']).optional(),
  weddingDate: z.string().optional(),
  residentialNeighbourhood: z.string().optional(),
  serviceInterest: z.string().optional(),
  baptizedByImmersion: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export async function updateUser(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  const permissions = req.user?.permissions ?? [];
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Check if user has permission to update users
  if (!permissions.includes('users:update')) {
    res.status(403).json({ success: false, message: 'Permission denied: users:update required' });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!target) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const { firstName, lastName, phone, email, password, roleName, districts, traditionalAuthorities, regions, churchId, membershipType, gender, dateOfBirth, maritalStatus, weddingDate, residentialNeighbourhood, serviceInterest, baptizedByImmersion, status } = parsed.data;
  
  // Role restrictions: only ministry_admin can assign roles other than 'member'
  // Additionally, prevent assignment of ministry_admin role (only available at signup)
  if (roleName === 'ministry_admin') {
    res.status(403).json({ 
      success: false, 
      message: 'National admin role can only be assigned during initial signup. Please contact support.' 
    });
    return;
  }
  
  if (roleName && role !== 'ministry_admin' && roleName !== 'member') {
    res.status(403).json({ 
      success: false, 
      message: 'Only national administrators can assign administrative roles. You can only assign member role.' 
    });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (firstName) updateData.firstName = firstName;
  if (lastName) updateData.lastName = lastName;
  if (phone !== undefined) updateData.phone = phone;
  if (email) updateData.email = email;
  if (password) updateData.password = await hashPassword(password);
  if (churchId !== undefined) updateData.churchId = churchId;
  if (membershipType !== undefined) updateData.membershipType = membershipType;
  if (gender !== undefined) updateData.gender = gender;
  if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  if (maritalStatus !== undefined) updateData.maritalStatus = maritalStatus;
  if (weddingDate !== undefined) updateData.weddingDate = weddingDate ? new Date(weddingDate) : null;
  if (residentialNeighbourhood !== undefined) updateData.residentialNeighbourhood = residentialNeighbourhood;
  if (serviceInterest !== undefined) updateData.serviceInterest = serviceInterest;
  if (baptizedByImmersion !== undefined) updateData.baptizedByImmersion = baptizedByImmersion;
  if (status) updateData.status = status;
  if (districts !== undefined) updateData.districts = JSON.stringify(districts);
  if (traditionalAuthorities !== undefined) updateData.traditionalAuthorities = JSON.stringify(traditionalAuthorities);
  if (regions !== undefined) updateData.regions = JSON.stringify(regions);

  if (roleName) {
    const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
    if (!roleRecord) {
      res.status(404).json({ success: false, message: `Role '${roleName}' not found` });
      return;
    }
    updateData.roleId = roleRecord.id;
    
    // Clear church and membership for non-member roles
    if (roleName !== 'member') {
      updateData.churchId = null;
      updateData.membershipType = null;
    }
    
    // Clear scope fields when role changes (let caller re-supply if needed)
    if (!districts) updateData.districts = null;
    if (!traditionalAuthorities) updateData.traditionalAuthorities = null;
    if (!regions) updateData.regions = null;
  }

  const updated = await prisma.user.update({
    where: { id: String(req.params.id) },
    data: updateData,
    include: USER_INCLUDE,
  });
  res.json({ success: true, data: safeUser(updated) });
}

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const permissions = req.user?.permissions ?? [];
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Check if user has permission to delete users
  if (!permissions.includes('users:delete')) {
    res.status(403).json({ success: false, message: 'Permission denied: users:delete required' });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!target) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  
  if (target.id === userId) {
    res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    return;
  }

  await prisma.user.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, message: 'User deleted' });
}

// ─── POST /api/users/bulk — bulk create users ────────────────────────────────

export async function bulkCreateUsers(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role ?? 'member';
  const permissions = req.user?.permissions ?? [];
  
  if (!userId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  if (!permissions.includes('users:create')) {
    res.status(403).json({ success: false, message: 'Permission denied: users:create required' });
    return;
  }

  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) {
    res.status(400).json({ success: false, message: 'Users array required' });
    return;
  }

  const results = { success: 0, failed: 0, errors: [] as any[] };

  for (const userData of users) {
    try {
      const parsed = createUserSchema.safeParse(userData);
      if (!parsed.success) {
        results.failed++;
        results.errors.push({ email: userData.email, error: parsed.error.errors[0].message });
        continue;
      }

      const { email, password, firstName, lastName, phone, gender, dateOfBirth, maritalStatus, weddingDate, residentialNeighbourhood, membershipType, serviceInterest, baptizedByImmersion, roleName, churchId } = parsed.data;

      // Check if user exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        results.failed++;
        results.errors.push({ email, error: 'Email already exists' });
        continue;
      }

      // Find role
      const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
      if (!roleRecord) {
        results.failed++;
        results.errors.push({ email, error: `Role '${roleName}' not found` });
        continue;
      }

      const hashed = await hashPassword(password);
      
      // Determine ministryAdminId
      let ministryAdminIdForNewUser: string | undefined;
      if (roleName === 'member') {
        if (role === 'ministry_admin') {
          ministryAdminIdForNewUser = userId;
        } else {
          const creator = await prisma.user.findUnique({ where: { id: userId }, select: { ministryAdminId: true } });
          ministryAdminIdForNewUser = creator?.ministryAdminId || undefined;
        }
      }

      await prisma.user.create({
        data: {
          email,
          password: hashed,
          firstName,
          lastName,
          phone,
          gender,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          maritalStatus,
          weddingDate: weddingDate ? new Date(weddingDate) : undefined,
          residentialNeighbourhood,
          membershipType,
          serviceInterest,
          baptizedByImmersion,
          roleId: roleRecord.id,
          churchId: churchId || null,
          ministryAdminId: ministryAdminIdForNewUser,
        },
      });

      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push({ email: userData.email, error: error.message });
    }
  }

  res.json(results);
}
