import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import type { UserRole } from '../types';

// Attach user (including permissions[]) from cookie to req.user
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.icims_token;

  if (!token) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
}

// Guard by role name (used for coarse role checks where needed)
export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
}

// Guard by permission string — primary authorization mechanism.
// Checks req.user.permissions[] which is embedded in the JWT on login (sourced from DB).
export function authorizePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }
    if (!req.user.permissions?.includes(permission)) {
      res.status(403).json({
        success: false,
        message: `Permission denied: '${permission}' required`,
      });
      return;
    }
    next();
  };
}
