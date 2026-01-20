// Test helpers and mock utilities for backend testing

import type { User, Session, PrivacyMode } from '../types/index.ts';

// Generate a mock UUID
export function mockUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Generate a mock user
export function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: mockUuid(),
    email: `test-${Date.now()}@example.com`,
    emailVerified: false,
    privacyMode: 'open_book' as PrivacyMode,
    custodialAddressIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Generate a mock session
export function mockSession(userId: string, overrides: Partial<Session> = {}): Session {
  return {
    id: mockUuid(),
    userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    ...overrides,
  };
}

// Mock database responses
export class MockDb {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private otpCodes: Map<string, { code: string; expiresAt: Date; used: boolean }> = new Map();

  addUser(user: User): void {
    this.users.set(user.id, user);
    this.users.set(user.email, user); // Index by email too
  }

  getUser(idOrEmail: string): User | null {
    return this.users.get(idOrEmail) ?? null;
  }

  addSession(session: Session): void {
    this.sessions.set(session.id, session);
  }

  getSession(id: string): Session | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    // Check if expired
    if (session.expiresAt < new Date()) return null;
    return session;
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  setOtpCode(email: string, code: string, expiresAt: Date): void {
    this.otpCodes.set(email, { code, expiresAt, used: false });
  }

  verifyOtpCode(email: string, code: string): boolean {
    const otp = this.otpCodes.get(email);
    if (!otp) return false;
    if (otp.used) return false;
    if (otp.expiresAt < new Date()) return false;
    if (otp.code !== code) return false;
    otp.used = true;
    return true;
  }

  clear(): void {
    this.users.clear();
    this.sessions.clear();
    this.otpCodes.clear();
  }
}

// Test assertions helper
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined');
  }
}
