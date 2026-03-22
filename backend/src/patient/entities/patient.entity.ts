import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Appointment } from '../../appointment/entities/appointment.entity';
import { PatientMedicalRecord } from '../../patient-medical-record/entities/patient-medical-record.entity';

@Entity('patients')
export class Patient {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    lastName: string;

    @Column({ type: 'varchar', length: 100 })
    firstName: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    middleName: string | null;

    @Column({ type: 'varchar', length: 30, nullable: true, unique: true })
    phone: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    email: string | null;

    @Column({ type: 'boolean', default: false })
    phoneVerified: boolean;

    @OneToOne(() => User, (user) => user.patient, { nullable: true })
    user: User | null;

    @OneToMany(() => Appointment, (appointment) => appointment.patient)
    appointments: Appointment[];

    @OneToOne(
        () => PatientMedicalRecord,
        (medicalRecord) => medicalRecord.patient,
        { nullable: true },
    )
    medicalRecord: PatientMedicalRecord | null;

}