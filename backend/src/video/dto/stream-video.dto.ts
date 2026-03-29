import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class StreamVideoDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;
}
