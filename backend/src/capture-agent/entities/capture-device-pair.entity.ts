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

@Entity('capture_device_pairs')
@Index(['agentId', 'pairKey'], { unique: true })
export class CaptureDevicePair {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  agentId: string;

  @ManyToOne(() => CaptureAgent, (agent) => agent.pairs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agentId' })
  agent: CaptureAgent;

  @Column({ type: 'varchar', length: 80 })
  pairKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', length: 1024 })
  videoDeviceId: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  videoLabel: string | null;

  @Column({ type: 'varchar', length: 1024 })
  audioDeviceId: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  audioLabel: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  isAvailable: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
