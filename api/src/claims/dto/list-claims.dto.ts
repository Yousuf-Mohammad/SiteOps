import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export const CLAIM_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PARTIALLY_APPROVED',
  'APPROVED',
  'REJECTED',
] as const;

export class ListClaimsDto extends PaginationDto {
  @IsOptional()
  @IsIn(CLAIM_STATUSES as unknown as string[])
  status?: string;

  /** Two-digit financial year, as it appears in the reference: `EXP 26-0042` -> 26. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  fy?: number;
}
