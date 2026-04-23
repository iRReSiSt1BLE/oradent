import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Cabinet } from '../../cabinet/entities/cabinet.entity';
import { CaptureDevice } from './capture-device.entity';
import { CaptureDevicePair } from './capture-device-pair.entity';

export enum CaptureAgentStatus {
    OFFLINE = 'offline',
    ONLINE = 'online',
}

@Entity('capture_agents')
export class CaptureAgent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255, unique: true })
    agentKey: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    cabinetId: string | null;

    @ManyToOne(() => Cabinet, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'cabinetId' })
    cabinet: Cabinet | null;

    @Column({ type: 'varchar', length: 32, default: CaptureAgentStatus.OFFLINE })
    status: CaptureAgentStatus;

    @Column({ type: 'varchar', length: 255, nullable: true })
    appVersion: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    lastIp: string | null;

    @Column({ type: 'datetime', nullable: true })
    lastSeenAt: Date | null;

    @Column({ type: 'datetime', nullable: true })
    wsConnectedAt: Date | null;

    @Column({ type: 'datetime', nullable: true })
    tokenIssuedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    lastError: string | null;

    @OneToMany(() => CaptureDevice, (device) => device.agent, {
        cascade: false,
    })
    devices: CaptureDevice[];

    @OneToMany(() => CaptureDevicePair, (pair) => pair.agent, {
        cascade: false,
    })
    pairs: CaptureDevicePair[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
