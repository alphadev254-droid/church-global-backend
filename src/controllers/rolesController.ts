import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';

// ─── GET /api/roles — list all roles for current user's church ─────────────────

export async function getRoles(req: Request, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role;
  
  // Roles are global
  const roles = await prisma.role.findMany({
    include: {
      _count: { select: { users: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Get permissions - use GLOBAL for ministry_admin and member
  const rolePermissions = await prisma.rolePermission.findMany({
    where: { ministryAdminId: 'GLOBAL' },
    include: { permission: true },
  });

  const data = roles.map(r => {
    const perms = rolePermissions
      .filter(rp => rp.roleId === r.id)
      .map(rp => rp.permission);
    
    return {
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      userCount: r._count.users,
      permissions: perms,
      createdAt: r.createdAt,
    };
  });

  res.json({ success: true, data });
}

// ─── GET /api/roles/permissions — list all available permission definitions ────

export async function getAllPermissions(_req: Request, res: Response): Promise<void> {
  const permissions = await prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
  res.json({ success: true, data: permissions });
}

// ─── PUT /api/roles/:id/permissions — replace permissions for a role ───────────

const updatePermsSchema = z.object({
  permissions: z.array(z.string()),  // array of permission names
});

export async function updateRolePermissions(req: Request, res: Response): Promise<void> {
  const permissions = req.user?.permissions ?? [];
  
  if (!permissions.includes('roles:manage')) {
    res.status(403).json({ success: false, message: 'Permission denied: roles:manage required' });
    return;
  }

  const parsed = updatePermsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.errors[0].message });
    return;
  }

  const roleId = String(req.params.id);
  const { permissions: permNames } = parsed.data;

  const roleRecord = await prisma.role.findUnique({ where: { id: roleId } });
  if (!roleRecord) {
    res.status(404).json({ success: false, message: 'Role not found' });
    return;
  }

  const permRecords = await prisma.permission.findMany({
    where: { name: { in: permNames } },
  });

  await prisma.rolePermission.deleteMany({
    where: { ministryAdminId: 'GLOBAL', roleId },
  });

  for (const perm of permRecords) {
    await prisma.rolePermission.create({
      data: {
        ministryAdminId: 'GLOBAL',
        roleId,
        permissionId: perm.id,
      },
    });
  }

  res.json({ success: true, message: 'Permissions updated' });
}

// ─── POST /api/roles/assign — assign a role to a user ─────────────────────────

const assignRoleSchema = z.object({
  userId: z.string(),
  roleName: z.string(),
});

export async function assignRole(req: Request, res: Response): Promise<void> {
  const parsed = assignRoleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.errors[0].message }); return; }

  const { userId, roleName } = parsed.data;
  const currentUserId = req.user?.userId;
  const currentUserRole = req.user?.role;

  if (!currentUserId) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  // Only national admins can assign roles
  if (currentUserRole !== 'ministry_admin') {
    res.status(403).json({ success: false, message: 'Only national administrators can assign roles' });
    return;
  }

  // Find the target user
  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Find the global role
  const role = await prisma.role.findUnique({
    where: { name: roleName },
  });
  if (!role) { res.status(404).json({ success: false, message: `Role '${roleName}' not found` }); return; }

  // Update the user's role
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { roleId: role.id },
    select: { id: true, email: true, firstName: true, lastName: true, role: { select: { name: true, displayName: true } } },
  });

  res.json({
    success: true,
    message: `Role '${role.displayName}' assigned to ${updated.firstName} ${updated.lastName}`,
    data: {
      ...updated,
      roleName: updated.role?.name || null,
    },
  });
}
