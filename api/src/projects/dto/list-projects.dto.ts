import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListProjectsDto extends PaginationDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: string;
}
