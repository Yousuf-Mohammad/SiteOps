import { IsIn, IsString, Length } from 'class-validator';

export const NOTE_ENTITY_TYPES = ['project', 'claim', 'docket', 'equipment'] as const;

export class ListNotesDto {
  @IsIn(NOTE_ENTITY_TYPES as unknown as string[])
  entityType: string;

  @IsString()
  entityId: string;
}

export class CreateNoteDto extends ListNotesDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}
