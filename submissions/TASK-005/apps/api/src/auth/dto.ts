import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken: string;
}

export class RequestPasswordResetDto {
  @IsEmail()
  email: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
