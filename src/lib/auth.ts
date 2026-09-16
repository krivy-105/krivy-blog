import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { sessionQueries, userQueries, type User } from './db';

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 天
const COOKIE_NAME = process.env.SESSION_COOKIE || 'blog_session';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(userId: number): string {
  const token = generateToken();
  const expiresAt = Date.now() + SESSION_DURATION;
  sessionQueries.create.run(userId, token, expiresAt);
  return token;
}

export function destroySession(token: string): void {
  sessionQueries.deleteByToken.run(token);
}

export function getUserFromToken(token: string): User | null {
  const row = sessionQueries.findByToken.get(token) as any;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return userQueries.findById.get(row.user_id) as User;
}

export { COOKIE_NAME, SESSION_DURATION };
