import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('cabinet_setup_sessions')
@Index(['connectionCode'], { unique: true })
export class CabinetSetupSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  connectionCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  agentKey: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  agentName: string | null;

  @Column({ type: 'varchar', length: 255 })
  createdByUserId: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
