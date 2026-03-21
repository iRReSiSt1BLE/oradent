import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Patient } from '../../patient/entities/patient.entity';

@Entity('patient_medical_records')
export class PatientMedicalRecord {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToOne(() => Patient, (patient) => patient.medicalRecord, {
        onDelete: 'CASCADE',
    })
    @JoinColumn()
    patient: Patient;

    @Column({ type: 'text', nullable: true })
    allergies: string | null;

    @Column({ type: 'text', nullable: true })
    medicalNotes: string | null;

    @Column({ type: 'text', nullable: true })
    contraindications: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}