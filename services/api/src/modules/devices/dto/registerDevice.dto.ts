import { IsIn, IsOptional, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsIn(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';

  @IsOptional()
  @IsString()
  voipToken?: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
