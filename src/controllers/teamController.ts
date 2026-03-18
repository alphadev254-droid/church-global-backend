import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';
import { queueEmail } from '../lib/emailQueue';
import { teamMemberAddedTemplate, teamLeaderAppointedTemplate } from '../lib/teamEmailTemplates';

export const getTeams = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { churchId } = req.query;
    
    if (!prisma.team) {
      return res.status(500).json({ error: 'Team model not found. Please run: npx prisma generate && npx prisma migrate dev' });
    }
    
    let teams;
    
    // For members, only return teams they belong to
    if (user.role === 'member') {
      const whereClause: any = {
        members: {
          some: { userId: user.userId }
        }
      };
      
      // Members can also filter by church if provided
      if (churchId && churchId !== 'all') {
        whereClause.churchId = churchId as string;
      }
      
      teams = await prisma.team.findMany({
        where: whereClause,
        include: {
          church: { select: { id: true, name: true } },
          members: {
            where: { isLeader: true },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
          _count: {
            select: { members: true }
          }
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // For admins, use church scope
      const churchIds = await getAccessibleChurchIds(
        user.role,
        user.churchId,
        user.districts,
        user.traditionalAuthorities,
        user.regions,
        user.userId
      );
      
      let whereClause: any;
      
      // If specific church filter is provided
      if (churchId && churchId !== 'all') {
        // Ensure the requested church is in accessible churches
        if (churchIds.includes(churchId as string)) {
          whereClause = { churchId: churchId as string };
        } else {
          // User doesn't have access to this church
          return res.json([]);
        }
      } else {
        // Show all accessible churches
        whereClause = { churchId: { in: churchIds } };
      }
      
      teams = await prisma.team.findMany({
        where: whereClause,
        include: {
          church: { select: { id: true, name: true } },
          members: {
            where: { isLeader: true },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
          _count: {
            select: { members: true }
          }
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    const formatted = teams.map(team => {
      // Check if current user is a leader of this team
      const isCurrentUserLeader = team.members.some(m => m.user.id === user.userId);
      
      return {
        ...team,
        memberCount: team._count.members,
        leaders: team.members.map(m => m.user),
        isLeader: isCurrentUserLeader, // Add flag for current user
        members: undefined,
        _count: undefined,
      };
    });

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createTeam = async (req: Request, res: Response) => {
  try {
    const { name, description, churchId, color } = req.body;
    const user = req.user!;
    const churchIds = await getAccessibleChurchIds(
      user.role,
      user.churchId,
      user.districts,
      user.traditionalAuthorities,
      user.regions,
      user.userId
    );

    if (!churchIds.includes(churchId)) {
      return res.status(403).json({ error: 'No access to this church' });
    }

    const team = await prisma.team.create({
      data: { name, description, churchId, color },
      include: {
        church: { select: { id: true, name: true } },
        members: true,
      },
    });

    res.status(201).json(team);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, color } = req.body;
    const user = req.user!;
    const churchIds = await getAccessibleChurchIds(
      user.role,
      user.churchId,
      user.districts,
      user.traditionalAuthorities,
      user.regions,
      user.userId
    );

    const team = await prisma.team.findUnique({ where: { id: String(id) } });
    if (!team || !churchIds.includes(team.churchId)) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const updated = await prisma.team.update({
      where: { id: String(id) },
      data: { name, description, color },
      include: {
        church: { select: { id: true, name: true } },
        members: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const churchIds = await getAccessibleChurchIds(
      user.role,
      user.churchId,
      user.districts,
      user.traditionalAuthorities,
      user.regions,
      user.userId
    );

    const team = await prisma.team.findUnique({ where: { id: String(id) } });
    if (!team || !churchIds.includes(team.churchId)) {
      return res.status(404).json({ error: 'Team not found' });
    }

    await prisma.team.delete({ where: { id: String(id) } });
    res.json({ message: 'Team deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTeamMembers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { search, limit = '100', offset = '0', minAge, maxAge } = req.query;
    const user = req.user!;
    const churchIds = await getAccessibleChurchIds(
      user.role,
      user.churchId,
      user.districts,
      user.traditionalAuthorities,
      user.regions,
      user.userId
    );

    const team = await prisma.team.findUnique({ where: { id: String(id) } });
    if (!team || !churchIds.includes(team.churchId)) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const limitNum = parseInt(limit as string) || 100;
    const offsetNum = parseInt(offset as string) || 0;

    const whereClause: any = {
      churchId: team.churchId,
      status: 'active',
    };

    if (search) {
      whereClause.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    
    // Age filtering using date calculations
    const minAgeNum = minAge ? parseInt(minAge as string) : undefined;
    const maxAgeNum = maxAge ? parseInt(maxAge as string) : undefined;
    
    if (minAgeNum !== undefined || maxAgeNum !== undefined) {
      const today = new Date();
      const ageFilters: any[] = [];
      
      if (minAgeNum !== undefined) {
        // Max date for minimum age (born on or before this date)
        const maxDateForMinAge = new Date(today.getFullYear() - minAgeNum, today.getMonth(), today.getDate());
        ageFilters.push({ dateOfBirth: { lte: maxDateForMinAge } });
      }
      
      if (maxAgeNum !== undefined) {
        // Min date for maximum age (born on or after this date)
        const minDateForMaxAge = new Date(today.getFullYear() - maxAgeNum - 1, today.getMonth(), today.getDate() + 1);
        ageFilters.push({ dateOfBirth: { gte: minDateForMaxAge } });
      }
      
      if (ageFilters.length > 0) {
        whereClause.AND = ageFilters;
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          membershipType: true,
          maritalStatus: true,
          serviceInterest: true,
          gender: true,
          dateOfBirth: true,
          weddingDate: true,
          anniversary: true,
          residentialNeighbourhood: true,
          baptizedByImmersion: true,
          teams: {
            where: { teamId: String(id) },
            select: { isLeader: true },
          },
        },
        orderBy: { firstName: 'asc' },
        take: limitNum,
        skip: offsetNum,
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    const formatted = users.map((u: any) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      membershipType: u.membershipType,
      maritalStatus: u.maritalStatus,
      serviceInterest: u.serviceInterest,
      gender: u.gender,
      dateOfBirth: u.dateOfBirth,
      weddingDate: u.weddingDate,
      anniversary: u.anniversary,
      residentialNeighbourhood: u.residentialNeighbourhood,
      baptizedByImmersion: u.baptizedByImmersion,
      inTeam: u.teams.length > 0,
      isLeader: u.teams[0]?.isLeader || false,
    }));

    // Count members actually in the team
    const teamMembersCount = await prisma.userTeam.count({
      where: { teamId: String(id) }
    });

    res.json({ data: formatted, total, limit: limitNum, offset: offsetNum, teamMembersCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const addTeamMember = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, isLeader = false } = req.body;
    const currentUser = req.user!;
    const churchIds = await getAccessibleChurchIds(
      currentUser.role,
      currentUser.churchId,
      currentUser.districts,
      currentUser.traditionalAuthorities,
      currentUser.regions,
      currentUser.userId
    );

    const team = await prisma.team.findUnique({ 
      where: { id: String(id) }, 
      include: { church: { select: { name: true } } } 
    });
    if (!team || !churchIds.includes(team.churchId)) {
      return res.status(404).json({ error: 'Team not found' });
    }

    await prisma.userTeam.upsert({
      where: { userId_teamId: { userId, teamId: String(id) } },
      update: { isLeader },
      create: { userId, teamId: String(id), isLeader },
    });

    const member = await prisma.user.findUnique({ where: { id: String(userId) } });
    const adminUser = await prisma.user.findUnique({ where: { id: currentUser.userId } });
    
    if (member && adminUser) {
      queueEmail(
        member.email,
        `Added to ${team.name}`,
        teamMemberAddedTemplate({
          firstName: member.firstName,
          teamName: team.name,
          churchName: team.church.name,
          addedBy: `${adminUser.firstName} ${adminUser.lastName}`
        })
      );
    }

    res.json({ message: 'Member added to team' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const removeTeamMember = async (req: Request, res: Response) => {
  try {
    const { id, userId } = req.params;
    const user = req.user!;
    const churchIds = await getAccessibleChurchIds(
      user.role,
      user.churchId,
      user.districts,
      user.traditionalAuthorities,
      user.regions,
      user.userId
    );

    const team = await prisma.team.findUnique({ where: { id: String(id) } });
    if (!team || !churchIds.includes(team.churchId)) {
      return res.status(404).json({ error: 'Team not found' });
    }

    await prisma.userTeam.delete({
      where: { userId_teamId: { userId: String(userId), teamId: String(id) } },
    });

    res.json({ message: 'Member removed from team' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTeamLeader = async (req: Request, res: Response) => {
  try {
    const { id, userId } = req.params;
    const { isLeader } = req.body;
    const currentUser = req.user!;
    const churchIds = await getAccessibleChurchIds(
      currentUser.role,
      currentUser.churchId,
      currentUser.districts,
      currentUser.traditionalAuthorities,
      currentUser.regions,
      currentUser.userId
    );

    const team = await prisma.team.findUnique({ 
      where: { id: String(id) }, 
      include: { church: { select: { name: true } } } 
    });
    if (!team || !churchIds.includes(team.churchId)) {
      return res.status(404).json({ error: 'Team not found' });
    }

    await prisma.userTeam.update({
      where: { userId_teamId: { userId: String(userId), teamId: String(id) } },
      data: { isLeader },
    });

    if (isLeader) {
      const member = await prisma.user.findUnique({ where: { id: String(userId) } });
      const adminUser = await prisma.user.findUnique({ where: { id: currentUser.userId } });
      
      if (member && adminUser) {
        queueEmail(
          member.email,
          `Team Leader Appointment - ${team.name}`,
          teamLeaderAppointedTemplate({
            firstName: member.firstName,
            teamName: team.name,
            churchName: team.church.name,
            appointedBy: `${adminUser.firstName} ${adminUser.lastName}`
          })
        );
      }
    }

    res.json({ message: 'Leader status updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
