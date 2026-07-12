import { validate } from 'class-validator';
import { RefreshDto, RequestPasswordResetDto, ConfirmPasswordResetDto } from './dto';

// Exercises the class-validator decorators directly (no HTTP layer/
// ValidationPipe needed) — cheap, fast, and catches the common
// mistake of a DTO field silently missing a decorator.
describe('auth hardening DTOs', () => {
  it('RefreshDto requires a non-empty string refreshToken', async () => {
    const dto = new RefreshDto();
    dto.refreshToken = '';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);

    const valid = new RefreshDto();
    valid.refreshToken = 'some-token';
    expect(await validate(valid)).toHaveLength(0);
  });

  it('RequestPasswordResetDto requires a valid email', async () => {
    const dto = new RequestPasswordResetDto();
    dto.email = 'not-an-email';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);

    const valid = new RequestPasswordResetDto();
    valid.email = 'user@example.com';
    expect(await validate(valid)).toHaveLength(0);
  });

  it('ConfirmPasswordResetDto rejects an empty token', async () => {
    const dto = new ConfirmPasswordResetDto();
    dto.token = '';
    dto.newPassword = 'longenoughpassword';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ConfirmPasswordResetDto rejects a newPassword shorter than 8 characters', async () => {
    const dto = new ConfirmPasswordResetDto();
    dto.token = 'some-token';
    dto.newPassword = 'short';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);

    const valid = new ConfirmPasswordResetDto();
    valid.token = 'some-token';
    valid.newPassword = 'longenoughpassword';
    expect(await validate(valid)).toHaveLength(0);
  });
});
