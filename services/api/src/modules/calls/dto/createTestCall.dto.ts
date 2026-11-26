import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTestCallDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  aiPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  voice?: string;
}
