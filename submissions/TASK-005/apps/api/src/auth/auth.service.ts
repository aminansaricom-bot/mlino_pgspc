import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto, RefreshDto, RequestPasswordResetDto, ConfirmPasswordResetDto } from './dto';

const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Refresh/reset tokens are long random strings; only their SHA-256 hash
// is ever stored (bcrypt is deliberately not used here — bcrypt's cost
// factor exists to slow down brute-forcing a *low-entropy* human
// password; these tokens are 256 bits of crypto-random data, already
// infeasible to brute-force, so a fast hash is the correct choice and
// keeps refresh() cheap).
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Known limitation, not fixed in this task: expired/revoked/used rows
// in RefreshToken and PasswordResetToken are never pruned. Harmless at
// MVP scale (small tables, indexed lookups stay fast), but a real
// deployment will eventually want a scheduled cleanup job — that's a
// new piece of infrastructure (a job runner), out of scope here per
// "do not create new architecture."

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // Configurable the same way JWT_SECRET/JWT_EXPIRES_IN already are in
  // auth.module.ts, rather than hardcoded — an operator can tighten
  // REFRESH_TOKEN_TTL_MS for a higher-security deployment without a
  // code change.
  private refreshTokenTtlMs(): number {
    const raw = this.config.get<string>('REFRESH_TOKEN_TTL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_TOKEN_TTL_MS;
  }

  private resetTokenTtlMs(): number {
    const raw = this.config.get<string>('RESET_TOKEN_TTL_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESET_TOKEN_TTL_MS;
  }

  private signAccessToken(userId: string, email: string) {
    return this.jwt.sign({ sub: userId, email });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = generateRawToken();
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + this.refreshTokenTtlMs()) },
    });
    return raw;
  }

  private async issueTokenPair(userId: string, email: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(userId, email),
      this.issueRefreshToken(userId),
    ]);
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('این ایمیل قبلاً ثبت شده است');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });
    const tokens = await this.issueTokenPair(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email, name: user.name } };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }
    const tokens = await this.issueTokenPair(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email, name: user.name } };
  }

  // Rotation: the presented refresh token is always revoked here,
  // whether or not the request succeeds past this point. A stolen
  // token that gets reused after the legitimate client already rotated
  // it will find revokedAt already set and be rejected — that's the
  // signal an attacker is replaying a captured token.
  //
  // The revoke is done as a single atomic conditional UPDATE
  // (updateMany ... WHERE revokedAt IS NULL AND expiresAt > now),
  // not a read-then-write — two concurrent refresh() calls presenting
  // the same still-valid token would otherwise both pass a plain
  // findUnique() check before either had revoked it, letting the same
  // token mint two token pairs. The conditional UPDATE closes that
  // window: only the request that actually flips the row wins.
  async refresh(dto: RefreshDto) {
    const tokenHash = hashToken(dto.refreshToken);
    const now = new Date();

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });

    if (claimed.count === 0) {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است');
    }

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    const user = stored ? await this.prisma.user.findUnique({ where: { id: stored.userId } }) : null;
    if (!user) {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است');
    }

    const tokens = await this.issueTokenPair(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email, name: user.name } };
  }

  // Never reveals whether the email exists — same response either way.
  // Logs the raw reset link server-side since no email provider is
  // configured yet (same stub pattern as malino-17tir's lib/sms.js —
  // // TODO: wire real email provider before this handles real users).
  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (user) {
      const raw = generateRawToken();
      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + this.resetTokenTtlMs()) },
      });
      // TODO: wire real email provider. Logging is the intentional MVP
      // stand-in, not a placeholder that was forgotten.
      this.logger.log(`Password reset requested for ${dto.email}. Reset token (send via email in production): ${raw}`);
    }

    return { message: 'اگر این ایمیل در سیستم ثبت باشد، لینک بازیابی رمز عبور برایش ارسال می‌شود.' };
  }

  // Same atomic-claim pattern as refresh() and for the same reason:
  // the token is claimed with a single conditional UPDATE (usedAt IS
  // NULL AND expiresAt > now), not a read-then-write. Without this,
  // two concurrent confirmPasswordReset() calls presenting the same
  // still-valid reset token could both pass a plain findUnique()
  // check before either had marked it used, running the password
  // update + refresh-token revocation twice.
  async confirmPasswordReset(dto: ConfirmPasswordResetDto): Promise<{ message: string }> {
    const tokenHash = hashToken(dto.token);
    const now = new Date();

    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (claimed.count === 0) {
      throw new UnauthorizedException('توکن بازیابی نامعتبر یا منقضی شده است');
    }

    const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!stored) {
      throw new UnauthorizedException('توکن بازیابی نامعتبر یا منقضی شده است');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    // usedAt is already claimed above, so the transaction only needs
    // the two remaining effects of a password reset.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      // A password reset is a strong signal the account may have been
      // compromised — revoke every outstanding refresh token so a
      // stolen session can't outlive the password change.
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'رمز عبور با موفقیت تغییر کرد.' };
  }
}
