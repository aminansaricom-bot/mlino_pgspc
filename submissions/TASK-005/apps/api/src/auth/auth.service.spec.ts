import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

// PrismaService is mocked, not a real DB connection — per TASK-003
// acceptance criteria ("keep them fast and CI-friendly"). Only the
// methods AuthService actually calls need stubs.
//
// refreshToken.create was added when TASK-005 made register()/login()
// also issue a refresh token — without a default resolved value here,
// every test in this file would fail on that step, not just the ones
// this file's own describe blocks are about.
function makePrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

function makeJwtMock() {
  return { sign: jest.fn().mockReturnValue('signed-jwt-token') } as unknown as JwtService;
}

// Added when TASK-005 gave AuthService a third constructor param
// (ConfigService, for configurable refresh/reset token TTLs). Returns
// undefined for every key, same as an .env with none of the optional
// overrides set — AuthService falls back to its documented defaults.
function makeConfigMock() {
  return { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
}

describe('AuthService', () => {
  describe('register', () => {
    it('creates a user and returns a token on the happy path', async () => {
      const prisma = makePrismaMock();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null); // no existing user with this email
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'new@example.com',
        name: 'New User',
        passwordHash: 'irrelevant-here',
      });
      const jwt = makeJwtMock();
      const service = new AuthService(prisma, jwt, makeConfigMock());

      const result = await service.register({ email: 'new@example.com', password: 'password123', name: 'New User' });

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.user).toEqual({ id: 'user-1', email: 'new@example.com', name: 'New User' });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      // the password must never be stored in plaintext
      const createArgs = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', createArgs.data.passwordHash)).toBe(true);
    });

    it('throws ConflictException when the email is already registered', async () => {
      const prisma = makePrismaMock();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-user', email: 'taken@example.com' });
      const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

      await expect(
        service.register({ email: 'taken@example.com', password: 'password123', name: 'Someone' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a token on correct credentials', async () => {
      const prisma = makePrismaMock();
      const passwordHash = await bcrypt.hash('correct-password', 10);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        passwordHash,
      });
      const jwt = makeJwtMock();
      const service = new AuthService(prisma, jwt, makeConfigMock());

      const result = await service.login({ email: 'user@example.com', password: 'correct-password' });

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.user.email).toBe('user@example.com');
    });

    it('throws UnauthorizedException for a non-existent email', async () => {
      const prisma = makePrismaMock();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

      await expect(service.login({ email: 'nobody@example.com', password: 'whatever' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a wrong password', async () => {
      const prisma = makePrismaMock();
      const passwordHash = await bcrypt.hash('correct-password', 10);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        passwordHash,
      });
      const service = new AuthService(prisma, makeJwtMock(), makeConfigMock());

      await expect(service.login({ email: 'user@example.com', password: 'wrong-password' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
