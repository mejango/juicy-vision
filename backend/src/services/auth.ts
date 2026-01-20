import * as jose from 'jose';
import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import type { User, Session, PrivacyMode } from '../types/index.ts';

interface DbUser {
  id: string;
  email: string;
  email_verified: boolean;
  privacy_mode: PrivacyMode;
  custodial_address_index: number | null;
  created_at: Date;
  updated_at: Date;
}

interface DbSession {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
}

interface DbOtpCode {
  id: string;
  email: string;
  code: string;
  expires_at: Date;
  used: boolean;
  created_at: Date;
}

// ============================================================================
// OTP Generation
// ============================================================================

const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

function generateOtpCode(): string {
  // Generate a 6-digit numeric code
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

export async function createOtpCode(email: string): Promise<string> {
  // Invalidate any existing codes for this email
  await execute(
    'UPDATE otp_codes SET used = TRUE WHERE email = $1 AND used = FALSE',
    [email]
  );

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await execute(
    `INSERT INTO otp_codes (email, code, expires_at)
     VALUES ($1, $2, $3)`,
    [email.toLowerCase(), code, expiresAt]
  );

  return code;
}

export async function verifyOtpCode(email: string, code: string): Promise<boolean> {
  const otpRecord = await queryOne<DbOtpCode>(
    `SELECT * FROM otp_codes
     WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase(), code]
  );

  if (!otpRecord) {
    return false;
  }

  // Mark code as used
  await execute('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otpRecord.id]);

  return true;
}

// Cleanup expired OTP codes (run periodically)
export async function cleanupExpiredOtpCodes(): Promise<number> {
  return await execute('DELETE FROM otp_codes WHERE expires_at < NOW() OR used = TRUE');
}

// ============================================================================
// JWT Handling
// ============================================================================

export async function generateToken(userId: string, sessionId: string): Promise<string> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);

  return await new jose.SignJWT({ userId, sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + config.sessionDurationMs) / 1000))
    .sign(secret);
}

export async function verifyToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    return {
      userId: payload.userId as string,
      sessionId: payload.sessionId as string,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// User Management
// ============================================================================

export async function findOrCreateUser(email: string): Promise<User> {
  const normalizedEmail = email.toLowerCase();

  // Try to find existing user
  let user = await findUserByEmail(normalizedEmail);

  if (!user) {
    // Get next custodial address index
    const maxIndexResult = await queryOne<{ max: number | null }>(
      'SELECT MAX(custodial_address_index) as max FROM users'
    );
    const nextIndex = (maxIndexResult?.max ?? -1) + 1;

    // Create new user
    const result = await query<DbUser>(
      `INSERT INTO users (email, custodial_address_index)
       VALUES ($1, $2)
       RETURNING *`,
      [normalizedEmail, nextIndex]
    );

    const dbUser = result[0];
    user = {
      id: dbUser.id,
      email: dbUser.email,
      emailVerified: dbUser.email_verified,
      privacyMode: dbUser.privacy_mode,
      custodialAddressIndex: dbUser.custodial_address_index ?? undefined,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
    };
  }

  return user;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const user = await queryOne<DbUser>(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified,
    privacyMode: user.privacy_mode,
    custodialAddressIndex: user.custodial_address_index ?? undefined,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export async function findUserById(id: string): Promise<User | null> {
  const user = await queryOne<DbUser>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified,
    privacyMode: user.privacy_mode,
    custodialAddressIndex: user.custodial_address_index ?? undefined,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export async function markEmailVerified(userId: string): Promise<void> {
  await execute(
    'UPDATE users SET email_verified = TRUE WHERE id = $1',
    [userId]
  );
}

export async function updateUserPrivacyMode(userId: string, privacyMode: PrivacyMode): Promise<void> {
  await execute(
    'UPDATE users SET privacy_mode = $1 WHERE id = $2',
    [privacyMode, userId]
  );
}

// ============================================================================
// Session Management
// ============================================================================

export async function createSession(userId: string): Promise<{ session: Session; token: string }> {
  const config = getConfig();
  const expiresAt = new Date(Date.now() + config.sessionDurationMs);

  const result = await query<DbSession>(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, $2)
     RETURNING *`,
    [userId, expiresAt]
  );

  const session = result[0];
  const token = await generateToken(userId, session.id);

  return {
    session: {
      id: session.id,
      userId: session.user_id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
    },
    token,
  };
}

export async function findValidSession(sessionId: string): Promise<Session | null> {
  const session = await queryOne<DbSession>(
    'SELECT * FROM sessions WHERE id = $1 AND expires_at > NOW()',
    [sessionId]
  );

  if (!session) return null;

  return {
    id: session.id,
    userId: session.user_id,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await execute('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await execute('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// Cleanup expired sessions (run periodically)
export async function cleanupExpiredSessions(): Promise<number> {
  return await execute('DELETE FROM sessions WHERE expires_at < NOW()');
}

// ============================================================================
// High-Level Auth Functions (OTP-based)
// ============================================================================

// Step 1: Request OTP - sends code to email
export async function requestOtp(email: string): Promise<{ code: string; expiresIn: number }> {
  const code = await createOtpCode(email);

  // TODO: Send email with code
  // For now, return the code directly (in production, this would only be sent via email)
  console.log(`[DEV] OTP code for ${email}: ${code}`);

  return {
    code, // Remove this in production!
    expiresIn: OTP_EXPIRY_MINUTES * 60,
  };
}

// Step 2: Verify OTP and login
export async function verifyOtpAndLogin(
  email: string,
  code: string
): Promise<{ user: User; token: string }> {
  const isValid = await verifyOtpCode(email, code);
  if (!isValid) {
    throw new Error('Invalid or expired code');
  }

  // Find or create user
  const user = await findOrCreateUser(email);

  // Mark email as verified if not already
  if (!user.emailVerified) {
    await markEmailVerified(user.id);
    user.emailVerified = true;
  }

  // Create session
  const { token } = await createSession(user.id);

  return { user, token };
}

export async function logout(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
}

export async function validateSession(token: string): Promise<{ user: User; session: Session } | null> {
  const payload = await verifyToken(token);
  if (!payload) return null;

  const session = await findValidSession(payload.sessionId);
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user) return null;

  return { user, session };
}

// ============================================================================
// Email Service (Placeholder)
// ============================================================================

export interface EmailService {
  sendOtpEmail(email: string, code: string): Promise<void>;
}

// Placeholder implementation - replace with actual email service
export const emailService: EmailService = {
  async sendOtpEmail(email: string, code: string): Promise<void> {
    // In production, use SendGrid, Resend, AWS SES, etc.
    console.log(`
    ╔════════════════════════════════════════════════════════╗
    ║  EMAIL: One-time code for Juicy Vision                ║
    ╠════════════════════════════════════════════════════════╣
    ║  To: ${email.padEnd(47)}║
    ║  Code: ${code.padEnd(45)}║
    ║  Expires in: ${OTP_EXPIRY_MINUTES} minutes${' '.repeat(33)}║
    ╚════════════════════════════════════════════════════════╝
    `);
  },
};
