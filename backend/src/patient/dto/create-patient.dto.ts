import {Column} from "typeorm";
import {IsPhoneNumber} from "class-validator";

export class CreatePatientDto {
    @Column()
    name: string;

    @Column()
    lastName: string;

    @Column()
    middleName: string;

    @Column()
    @IsPhoneNumber('UA')
    phoneNumber: string;
}
