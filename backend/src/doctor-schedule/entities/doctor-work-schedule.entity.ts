import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Doctor } from '../../doctor/entities/doctor.entity';

@Entity('doctor_work_schedules')
export class DoctorWorkSchedule {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToOne(() => Doctor, { onDelete: 'CASCADE', eager: true })
    @JoinColumn({ name: 'doctorId' })
    doctor: Doctor;

    @Column({ type: 'varchar', length: 50, default: 'Europe/Kiev' })
    timezone: string;

    @Column({ type: 'int', default: 20 })
    slotMinutes: number;

    @Column({ type: 'varchar', length: 20, default: 'WEEKLY' })
    templateType: 'WEEKLY' | 'CYCLE';

    @Column({ type: 'simple-json', nullable: true })
    weeklyTemplate: Array<{
        weekday: number;
        enabled: boolean;
        start: string;
        end: string;
        breaks: Array<{ start: string; end: string }>;
    }> | null;

    @Column({ type: 'simple-json', nullable: true })
    cycleTemplate: {
        workDays: number;
        offDays: number;
        anchorDate: string;
        start: string;
        end: string;
        breaks: Array<{ start: string; end: string }>;
    } | null;

    @Column({ type: 'simple-json', nullable: true })
    dayOverrides: Array<{
        date: string;
        enabled: boolean;
        start: string;
        end: string;
        breaks: Array<{ start: string; end: string }>;
    }> | null;

    @Column({ type: 'simple-json', nullable: true })
    blockedDays: string[] | null;

    @Column({ type: 'simple-json', nullable: true })
    blockedSlots: Array<{
        date: string;
        start: string;
        end: string;
        reason?: string;
    }> | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    updatedByUserId: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
