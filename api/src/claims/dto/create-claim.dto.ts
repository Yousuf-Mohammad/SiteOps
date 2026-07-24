import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ClaimLineDto {
  @IsString()
  description: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsBoolean()
  isFuel?: boolean;
}

export class CreateClaimDto {
  @IsString()
  projectId: string;

  @IsDateString()
  expenseDate: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimLineDto)
  lines: ClaimLineDto[];
}
