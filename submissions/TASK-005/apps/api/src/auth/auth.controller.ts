import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto, RequestPasswordResetDto, ConfirmPasswordResetDto } from './dto';

// Throttle limit for login/register: 5 requests per 60 seconds per IP
// by default. Chosen to comfortably allow a human mistyping a password
// a few times while blocking sustained credential-stuffing/brute-force
// attempts. Overridable via AUTH_THROTTLE_LIMIT / AUTH_THROTTLE_TTL_MS
// for deployments that want a different tradeoff, without a code change.
const AUTH_THROTTLE = {
  default: {
    limit: Number(process.env.AUTH_THROTTLE_LIMIT) || 5,
    ttl: Number(process.env.AUTH_THROTTLE_TTL_MS) || 60_000,
  },
};

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(dto);
  }
}
