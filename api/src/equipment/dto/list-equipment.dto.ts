import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListEquipmentDto extends PaginationDto {
  @IsOptional()
  @IsIn(['PAVER', 'ROLLER', 'TRUCK', 'EXCAVATOR', 'TRAFFIC', 'MISC'])
  category?: string;
}
