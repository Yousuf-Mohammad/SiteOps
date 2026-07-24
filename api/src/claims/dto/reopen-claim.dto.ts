import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { ClaimLineDto } from './create-claim.dto';

/**
 * Correcting a rejected claim.
 *
 * `lines` reuses `ClaimLineDto` rather than restating the rules, so a correction
 * can never be held to a looser standard than the original.
 *
 * Nothing else is editable. `expenseDate` in particular is fixed at creation: it
 * decides the FY inside the reference and selects the levy rate, so changing it
 * would make `EXP 26-0007` name a claim it no longer describes. A claim for a
 * different date is a different claim.
 */
export class ReopenClaimDto {
  /**
   * Corrected lines. Omit to reopen the claim unchanged — which is the case
   * where the claim was rejected in error and nothing needs fixing.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ClaimLineDto)
  lines?: ClaimLineDto[];
}
