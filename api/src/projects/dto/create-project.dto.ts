import { IsString, Length, Matches } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Matches(/^[A-Z0-9-]+$/, { message: 'code must be uppercase letters, digits or dashes' })
  @Length(2, 20)
  code: string;

  @IsString()
  @Length(2, 120)
  name: string;
}
