import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ClaimLineDto {
  @IsString()
  @MaxLength(500)
  description: string;

  @IsInt()
  @IsPositive()
  quantity: number;

  // Money arrives ex-GST and exact to the cent. A third decimal place would be
  // silently rounded away by the totals function, so reject it at the edge.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice: number;

  @IsOptional()
  @IsBoolean()
  isFuel?: boolean;
}

export class CreateClaimDto {
  @IsString()
  projectId: string;

  /** Drives the FY, the reference and the levy rate — never `now()`. */
  @IsDateString()
  expenseDate: string;

  // `status` is deliberately absent. It used to be accepted from the body, which
  // let a caller POST a claim straight to APPROVED and skip the whole workflow.
  // Creation is always DRAFT; status moves only through the workflow endpoints.

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ClaimLineDto)
  lines: ClaimLineDto[];
}
