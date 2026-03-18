import { Request, Response, NextFunction } from 'express';
import { hasFeature } from '../lib/packageChecker';

export function requireFeature(featureName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const allowed = await hasFeature(userId, featureName);

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: `This feature is not available in your current package. Please upgrade to access ${featureName.replace(/_/g, ' ')}.`,
        featureRequired: featureName,
      });
    }

    next();
  };
}
