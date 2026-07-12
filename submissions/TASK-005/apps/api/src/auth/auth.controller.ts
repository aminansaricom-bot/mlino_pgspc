import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto, RequestPasswordResetDto, ConfirmPasswordResetDto } from './dto';

// The actual limit (default 5 requests / 60 seconds per IP) is
// configured once in auth.module.ts's ThrottlerModule.forRootAsync via
// ConfigService (AUTH_THROTTLE_LIMIT / AUTH_THROTTLE_TTL_MS), the same
// place JWT_SECRET/JWT_EXPIRES_IN are read — not here. This file only
// says *which* routes are throttled, not the limit itself. An earlier
// revision read process.env directly in a per-route @Throttle()
// override here; moved per review to keep exactly one source of
// configuration truth for the whole auth module.
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(ThrottlerGuard)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(ThrottlerGuard)
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
