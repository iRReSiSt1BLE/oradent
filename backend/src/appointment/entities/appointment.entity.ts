import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Patient } from '../../patient/entities/patient.entity';

@Entity('appointments')
export class Appointment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Patient, (patient) => patient.appointments, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    patient: Patient;

    @Column({ type: 'varchar', length: 100, nullable: true })
    doctorId: string | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    serviceId: string | null;

    @Column({ type: 'datetime', nullable: true })
    appointmentDate: Date | null;

    @Column({ type: 'text', nullable: true })
    reason: string | null;

    @Column({ type: 'varchar', length: 50, default: 'BOOKED' })
    status: string;

    @Column({ type: 'varchar', length: 50, default: 'GUEST' })
    source: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}