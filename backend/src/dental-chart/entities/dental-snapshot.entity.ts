import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type DentalSnapshotTargetType = 'TOOTH' | 'JAW' | 'MOUTH';
export type DentalSnapshotJaw = 'UPPER' | 'LOWER' | 'WHOLE';
export type DentalSnapshotSource = 'CAPTURE_AGENT' | 'MANUAL_UPLOAD' | 'NOTE_ONLY';

@Entity('dental_snapshots')
export class DentalSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  patientId!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  appointmentId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  doctorId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cabinetId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cabinetDeviceId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  pairKey!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'MOUTH' })
  targetType!: DentalSnapshotTargetType;

  @Column({ type: 'varchar', length: 32, nullable: true })
  targetId!: string | null;

  @Column({ type: 'int', nullable: true })
  toothNumber!: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  jaw!: DentalSnapshotJaw | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalFileName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  storedFileName!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  storageRelativePath!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType!: string | null;

  @Column({ type: 'bigint', default: 0 })
  size!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  sha256Hash!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  encryptionAlgorithm!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  encryptionIv!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  encryptionAuthTag!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'CAPTURE_AGENT' })
  source!: DentalSnapshotSource;

  @Column({ type: 'datetime', nullable: true })
  capturedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
