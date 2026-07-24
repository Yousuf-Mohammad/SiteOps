import { IsDateString, IsDecimal, IsOptional, IsString, Length } from 'class-validator';

export class CreateDocketDto {
  @IsString()
  projectId: string;

  @IsString()
  equipmentId: string;

  @IsDateString()
  workDate: string;

  @IsDecimal({ decimal_digits: '0,2' })
  hours: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
