import { PartialType } from '@nestjs/mapped-types';
import { CreateCabinetDto } from './create-cabinet.dto';

export class UpdateCabinetDto extends PartialType(CreateCabinetDto) {}
