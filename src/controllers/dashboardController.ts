import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getAccessibleChurchIds } from '../lib/churchScope';

export async function getStats(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const churchId = req.user?.churchId;
  const roleName = req.user?.role ?? 'member';
  
  if (!userId) { 
    res.status(401).json({ success: false, message: 'User not authenticated' }); 
    return; 
  }

  let churchIds: string[] = [];

  if (roleName === 'member') {
    // Members see stats only for their church
    if (!churchId) {
      res.status(400).json({ success: false, message: 'No church assigned' });
      return;
    }
    churchIds = [churchId];

    // Get member-specific data
    const [myDonations, churchEvents] = await Promise.all([
      prisma.donationTransaction.findMany({ where: { userId } }),
      prisma.event.findMany({ where: { churchId } }),
    ]);

    const myTotalDonations = myDonations.filter(d => d.status === 'completed').reduce((sum, d) => sum + d.amount, 0);

    res.json({
      success: true,
      data: {
        myTotalDonations,
        myDonationRecords: myDonations.length,
        upcomingEvents: churchEvents.filter(e => e.status === 'upcoming').length,
        totalEvents: churchEvents.length,
      },
    });
    return;
  }

  if (roleName === 'ministry_admin') {
    // For national admin, get churches where they are the ministryAdminId
    const churches = await prisma.church.findMany({ 
      where: { ministryAdminId: userId },
      select: { id: true } 
    });
    churchIds = churches.map(c => c.id);
  } else {
    // For other roles, use the existing churchScope logic
    if (!churchId) { 
      res.status(400).json({ success: false, message: 'churchId required for this role' }); 
      return; 
    }
    churchIds = await getAccessibleChurchIds(roleName, churchId, req.user?.districts, req.user?.traditionalAuthorities, req.user?.regions, userId);
  }

  const [users, events, donations, attendance] = await Promise.all([
    prisma.user.findMany({ where: { churchId: { in: churchIds } } }),
    prisma.event.findMany({ where: { churchId: { in: churchIds } } }),
    prisma.donationTransaction.findMany({ 
      where: { churchId: { in: churchIds }, status: 'completed' },
      select: { amount: true, createdAt: true }
    }),
    prisma.attendance.findMany({ 
      where: { churchId: { in: churchIds } },
      select: { totalAttendees: true, date: true, newVisitors: true },
      orderBy: { date: 'desc' },
      take: 12 // Last 12 records for charts
    }),
  ]);

  const totalChurches = churchIds.length;
  const totalDonations = donations.reduce((sum, d) => sum + d.amount, 0);
  const avgAttendance = attendance.length
    ? Math.round(attendance.reduce((sum, a) => sum + a.totalAttendees, 0) / attendance.length)
    : 0;

  // Calculate real growth rates
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const lastMonthUsers = users.filter(u => new Date(u.createdAt) < now && new Date(u.createdAt) >= lastMonth).length;
  const prevMonthUsers = users.filter(u => new Date(u.createdAt) < lastMonth && new Date(u.createdAt) >= twoMonthsAgo).length;
  const memberGrowth = prevMonthUsers > 0 ? Number(((lastMonthUsers - prevMonthUsers) / prevMonthUsers * 100).toFixed(1)) : 0;

  const lastMonthDonations = donations.filter(d => new Date(d.createdAt) >= lastMonth).reduce((sum, d) => sum + d.amount, 0);
  const prevMonthDonations = donations.filter(d => new Date(d.createdAt) >= twoMonthsAgo && new Date(d.createdAt) < lastMonth).reduce((sum, d) => sum + d.amount, 0);
  const donationGrowth = prevMonthDonations > 0 ? Number(((lastMonthDonations - prevMonthDonations) / prevMonthDonations * 100).toFixed(1)) : 0;

  // New metrics
  const totalNewVisitors = attendance.reduce((sum, a) => sum + a.newVisitors, 0);
  const activeMembers = users.filter(u => u.status === 'active').length;
  const retentionRate = users.length > 0 ? Number(((activeMembers / users.length) * 100).toFixed(1)) : 0;
  
  // Attendance rate
  const attendanceRate = users.length > 0 ? Number(((avgAttendance / users.length) * 100).toFixed(1)) : 0;

  // Prepare weekly attendance data (last 4 weeks)
  const weeklyAttendance = attendance.slice(0, 4).reverse().map((a, idx) => ({
    week: `Week ${idx + 1}`,
    attendees: a.totalAttendees,
    date: a.date
  }));

  // Prepare monthly giving data (last 6 months)
  const monthlyGiving: { month: string; amount: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const monthName = monthDate.toLocaleDateString('en-US', { month: 'short' });
    const monthTotal = donations
      .filter(d => {
        const dDate = new Date(d.createdAt);
        return dDate >= monthDate && dDate < nextMonth;
      })
      .reduce((sum, d) => sum + d.amount, 0);
    monthlyGiving.push({ month: monthName, amount: Math.round(monthTotal) });
  }

  res.json({
    success: true,
    data: {
      totalMembers: users.length,
      activeMembers,
      totalChurches,
      totalDonations,
      upcomingEvents: events.filter(e => e.status === 'upcoming').length,
      averageAttendance: avgAttendance,
      memberGrowth,
      donationGrowth,
      totalNewVisitors,
      retentionRate,
      attendanceRate,
      newMembersThisMonth: lastMonthUsers,
      weeklyAttendance,
      monthlyGiving,
    },
  });
}
