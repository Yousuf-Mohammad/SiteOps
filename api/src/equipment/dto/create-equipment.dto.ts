import { IsDecimal, IsIn, IsString, Length, Matches } from 'class-validator';

export class CreateEquipmentDto {
  @IsString()
  @Matches(/^[A-Z0-9-]+$/)
  @Length(2, 16)
  assetCode: string;

  @IsString()
  @Length(2, 120)
  name: string;

  @IsIn(['PAVER', 'ROLLER', 'TRUCK', 'EXCAVATOR', 'TRAFFIC', 'MISC'])
  category: string;

  // Money crosses the wire as a string; Prisma stores Decimal(10,2).
  @IsDecimal({ decimal_digits: '0,2' })
  hireRatePerDay: string;
}
