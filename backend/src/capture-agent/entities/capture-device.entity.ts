import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { CaptureAgent } from './capture-agent.entity';

@Entity('capture_devices')
@Index(['agentId', 'kind', 'deviceId'], { unique: true })
export class CaptureDevice {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    agentId: string;

    @ManyToOne(() => CaptureAgent, (agent) => agent.devices, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'agentId' })
    agent: CaptureAgent;

    @Column({ type: 'varchar', length: 32 })
    kind: string;

    @Column({ type: 'varchar', length: 1024 })
    deviceId: string;

    @Column({ type: 'varchar', length: 1024, nullable: true })
    label: string | null;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @Column({ type: 'boolean', default: true })
    isAvailable: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
