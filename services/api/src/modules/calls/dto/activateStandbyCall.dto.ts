import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ActivateStandbyCallDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @MaxLength(120)
  roomName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  aiPrompt?: string;
}
