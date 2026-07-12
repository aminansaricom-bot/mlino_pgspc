import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'change-me-in-production',
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '7d' },
      }),
    }),
    // Scoped to this module only (ThrottlerGuard is applied per-route
    // in auth.controller.ts via @UseGuards, not globally via APP_GUARD)
    // — deliberately not touching app.module.ts, out of scope for this
    // task per PGSPC.md's Files To Modify.
    //
    // forRootAsync + ConfigService, same pattern as JwtModule above —
    // this is also where AUTH_THROTTLE_LIMIT/AUTH_THROTTLE_TTL_MS are
    // read from (not process.env directly in the controller, which is
    // what an earlier revision of this file did before review).
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get<string>('AUTH_THROTTLE_TTL_MS')) || 60_000,
          limit: Number(config.get<string>('AUTH_THROTTLE_LIMIT')) || 5,
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
