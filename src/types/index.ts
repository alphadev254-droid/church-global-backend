export type UserRole =
  | 'ministry_admin'
  | 'regional_admin'
  | 'district_admin'
  | 'branch_admin'
  | 'member';

export type PackageTier = 'basic' | 'standard' | 'premium';
export type ChurchLevel = 'national' | 'regional' | 'district' | 'local';

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;         // convenience role name string
  churchId: string | null;
  permissions: string[];
  // Geographic scope — determines which churches this user accesses
  regions?: string[];                // regional_admin: ["Central","Northern"] or ["__all__"]
  districts?: string[];              // district_admin: ["Lilongwe","Dedza"] or ["__all__"]
  traditionalAuthorities?: string[]; // branch_admin: ["Kalumbu","Njewa"] or ["__all__"]
}

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
