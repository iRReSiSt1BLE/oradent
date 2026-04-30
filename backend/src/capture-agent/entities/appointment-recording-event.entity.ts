import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('appointment_recording_events')
@Index(['appointmentId', 'cabinetDeviceId'])
@Index(['appointmentId', 'createdAt'])
export class AppointmentRecordingEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    appointmentId: string;

    @Column({ type: 'varchar', length: 100 })
    cabinetDeviceId: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    agentId: string | null;

    @Column({ type: 'varchar', length: 64 })
    state: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    command: string | null;

    @Column({ type: 'varchar', length: 150, nullable: true })
    pairKey: string | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    entryId: string | null;

    @Column({ type: 'bigint', nullable: true })
    totalBytes: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    sha256Hash: string | null;

    @Column({ type: 'boolean', default: false })
    uploaded: boolean;

    @Column({ type: 'varchar', length: 100 })
    eventId: string;

    @Column({ type: 'int' })
    sequence: number;

    @Column({ type: 'datetime', nullable: true })
    reportedAt: Date | null;

    @Column({ type: 'datetime' })
    receivedAt: Date;

    @Column({ type: 'longtext', nullable: true })
    payloadJson: string | null;

    @CreateDateColumn()
    createdAt: Date;
}
