import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeclinePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  declineToken!: string;
}
