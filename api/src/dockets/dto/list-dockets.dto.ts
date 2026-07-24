import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListDocketsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'CONFIRMED'])
  status?: string;
}
