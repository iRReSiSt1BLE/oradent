import {Column, Entity, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Appointment} from "../../appointment/entities/appointment.entity";

@Entity()
export class Patient {
    @PrimaryGeneratedColumn({name: 'ID'})
    id: number;

    @Column()
    name: string;

    @Column()
    lastName: string;

    @Column()
    middleName: string;

    @Column()
    phoneNumber: string;

    @OneToMany(()=>Appointment, (appointment)=> appointment.patient,
        {onDelete: 'CASCADE'})
    appointments: Appointment[];
}
