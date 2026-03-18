import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('videos')
export class Video {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    appointmentId: string | null;

    @Column({ type: 'varchar', length: 255 })
    originalFileName: string;

    @Column({ type: 'varchar', length: 255 })
    storedFileName: string;

    @Column({ type: 'varchar', length: 500 })
    storageRelativePath: string;

    @Column({ type: 'varchar', length: 100 })
    mimeType: string;

    @Column({ type: 'bigint' })
    size: number;

    @Column({ type: 'varchar', length: 128, nullable: true })
    sha256Hash: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    manifestRelativePath: string | null;

    @Column({ type: 'longtext', nullable: true })
    manifestSignature: string | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    signatureAlgorithm: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    tsaRequestRelativePath: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    tsaResponseRelativePath: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    tsaProvider: string | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    tsaHashAlgorithm: string | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    encryptionAlgorithm: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    encryptionIv: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    encryptionAuthTag: string | null;

    @Column({ type: 'datetime', nullable: true })
    encryptedAt: Date | null;

    @Column({ type: 'datetime', nullable: true })
    startedAt: Date | null;

    @Column({ type: 'datetime', nullable: true })
    endedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;
}