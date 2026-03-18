import {Column, Entity, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {Patient} from "../../patient/entities/patient.entity";

@Entity()
export class Appointment {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(()=>Patient, (patient)=>patient.appointments)
    patient: Patient;
}
