import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { env } from './env.js';

export type TokenMeta = { userAgent?: string | null; ipAddress?: string | null };

export type RotateResult =
  | { ok: true; userId: string; raw: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'reused' };

const TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function refreshExpiry(): Date {
  const ms = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

export async function issueRefreshToken(userId: string, meta: TokenMeta = {}): Promise<string> {
  const raw = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId: randomUUID(),
      tokenHash: hashToken(raw),
      expiresAt: refreshExpiry(),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    },
  });
  return raw;
}

export async function rotateRefreshToken(rawToken: string, meta: TokenMeta = {}): Promise<RotateResult> {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) return { ok: false, reason: 'not_found' };

  if (existing.revokedAt !== null) {
    await revokeFamilyById(existing.familyId);
    return { ok: false, reason: 'reused' };
  }

  if (existing.expiresAt <= new Date()) {
    return { ok: false, reason: 'expired' };
  }

  const newRaw = generateRefreshToken();
  const newId = randomUUID();
  const newHash = hashToken(newRaw);
  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const { count } = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: now, replacedBy: newId },
    });
    if (count === 0) return null;

    return tx.refreshToken.create({
      data: {
        id: newId,
        userId: existing.userId,
        familyId: existing.familyId,
        tokenHash: newHash,
        expiresAt: refreshExpiry(),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });
  });

  if (!created) {
    await revokeFamilyById(existing.familyId);
    return { ok: false, reason: 'reused' };
  }

  return { ok: true, userId: existing.userId, raw: newRaw };
}

export async function revokeByRawToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeFamilyById(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
