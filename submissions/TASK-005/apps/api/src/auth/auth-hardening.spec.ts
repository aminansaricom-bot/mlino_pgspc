import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService;
}

function makeJwtMock() {
  return { sign: jest.fn().mockReturnValue('signed-jwt-token') } as unknown as JwtService;
}

function makeConfigMock() {
  // get() returns undefined for every key, matching an .env with none
  // of the optional overrides set — AuthService falls back to its
  // documented defaults (30d refresh, 1h reset) in that case.
  return { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
}

describe('AuthService — refresh tokens', () => {
  it('register and login both return a refreshToken alongside accessToken', async () => {
    const prisma = makePrismaMock();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', passwordHash: 'x' });
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    const result = await service.register({ email: 'a@b.com', password: 'password123', name: 'A' });
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(typeof result.refreshToken).toBe('string');
  });

  it('refresh() with a valid token atomically claims it, then returns a new pair', async () => {
    const prisma = makePrismaMock();
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 }); // claim succeeded
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({ id: 'rt-1', userId: 'u1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    const result = await service.refresh({ refreshToken: 'some-raw-token' });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    // the claim is conditional on revokedAt: null AND expiresAt in the
    // future — this is what makes it atomic instead of read-then-write.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refresh() rejects an unknown token (claim affects zero rows)', async () => {
    const prisma = makePrismaMock();
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    await expect(service.refresh({ refreshToken: 'never-issued' })).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled(); // short-circuits before the extra lookup
  });

  it('refresh() rejects an already-revoked token (replay attempt) — the conditional claim can never match it', async () => {
    const prisma = makePrismaMock();
    // revokedAt: null in the WHERE clause means an already-revoked row
    // can never be matched, so the mock's job is just to reflect that:
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    await expect(service.refresh({ refreshToken: 'already-used' })).rejects.toThrow(UnauthorizedException);
  });

  it('refresh() rejects an expired token — the conditional claim can never match it', async () => {
    const prisma = makePrismaMock();
    // expiresAt: { gt: now } in the WHERE clause means an expired row
    // can never be matched:
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    await expect(service.refresh({ refreshToken: 'expired' })).rejects.toThrow(UnauthorizedException);
  });

  it('refresh() rejects a claimed token whose user no longer exists (orphaned token)', async () => {
    const prisma = makePrismaMock();
    (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({ id: 'rt-1', userId: 'deleted-user' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    await expect(service.refresh({ refreshToken: 'orphaned' })).rejects.toThrow(UnauthorizedException);
  });

  it('honors REFRESH_TOKEN_TTL_MS override when issuing a refresh token', async () => {
    const prisma = makePrismaMock();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', passwordHash: 'x' });
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});
    const config = { get: jest.fn().mockReturnValue('3600000') } as unknown as ConfigService; // 1 hour override
    const service2 = new AuthService(prisma, makeJwtMock(), config);

    const before = Date.now();
    await service2.register({ email: 'a@b.com', password: 'password123', name: 'A' });

    const createArgs = (prisma.refreshToken.create as jest.Mock).mock.calls[0][0];
    const expiresAtMs = new Date(createArgs.data.expiresAt).getTime();
    // should be ~1 hour out, not the 30-day default
    expect(expiresAtMs - before).toBeLessThan(3_700_000);
    expect(expiresAtMs - before).toBeGreaterThan(3_500_000);
  });
});

describe('AuthService — password reset', () => {
  it('requestPasswordReset returns the same message whether or not the email exists', async () => {
    const prisma = makePrismaMock();
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const forUnknown = await service.requestPasswordReset({ email: 'nobody@example.com' });

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'real@example.com' });
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({});
    const forKnown = await service.requestPasswordReset({ email: 'real@example.com' });

    expect(forUnknown.message).toBe(forKnown.message);
  });

  it('requestPasswordReset only creates a token row when the user exists', async () => {
    const prisma = makePrismaMock();
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await service.requestPasswordReset({ email: 'nobody@example.com' });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'real@example.com' });
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({});
    await service.requestPasswordReset({ email: 'real@example.com' });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
  });

  it('confirmPasswordReset updates the password with a valid token', async () => {
    const prisma = makePrismaMock();
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
      id: 'prt-1',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 100_000),
    });
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    const result = await service.confirmPasswordReset({ token: 'valid-token', newPassword: 'newpassword123' });

    expect(result.message).toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('confirmPasswordReset rejects an already-used token', async () => {
    const prisma = makePrismaMock();
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
      id: 'prt-1',
      userId: 'u1',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000),
    });
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    await expect(
      service.confirmPasswordReset({ token: 'already-used', newPassword: 'newpassword123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('confirmPasswordReset rejects an expired token', async () => {
    const prisma = makePrismaMock();
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
      id: 'prt-1',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

    await expect(service.confirmPasswordReset({ token: 'expired', newPassword: 'newpassword123' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

// Sanity check on the bcrypt claim in the module comment: passwords
// hashed by bcrypt.hash must verify with bcrypt.compare.
describe('bcrypt sanity check', () => {
  it('a hashed password verifies correctly', async () => {
    const hash = await bcrypt.hash('some-password', 10);
    expect(await bcrypt.compare('some-password', hash)).toBe(true);
    expect(await bcrypt.compare('wrong-password', hash)).toBe(false);
  });
});
