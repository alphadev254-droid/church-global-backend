import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types';

const SECRET = process.env.JWT_SECRET || 'fallback-secret';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}
