import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';
import { Cabinet } from './cabinet.entity';
import { Doctor } from '../../doctor/entities/doctor.entity';

@Entity('cabinet_doctors')
@Unique('UQ_cabinet_doctor_pair', ['cabinetId', 'doctorId'])
export class CabinetDoctor {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'char', length: 36 })
    cabinetId: string;

    @Column({ type: 'char', length: 36 })
    doctorId: string;

    @ManyToOne(() => Cabinet, (cabinet) => cabinet.doctorAssignments, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'cabinetId' })
    cabinet: Cabinet;

    @ManyToOne(() => Doctor, {
        nullable: false,
        eager: true,
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'doctorId' })
    doctor: Doctor;
}
