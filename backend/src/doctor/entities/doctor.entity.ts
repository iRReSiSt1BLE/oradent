import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity('doctors')
export class Doctor {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToOne(() => User, { onDelete: 'CASCADE', eager: true })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: 'varchar', length: 100 })
    lastName: string;

    @Column({ type: 'varchar', length: 100 })
    firstName: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    middleName: string | null;

    @Column({ type: 'varchar', length: 140, nullable: true })
    specialty: string | null;

    @Column({ type: 'simple-json', nullable: true })
    specialties: string[] | null;

    @Column({ type: 'text', nullable: true })
    infoBlock: string | null;

    @Column({ type: 'varchar', length: 20, unique: true })
    phone: string;

    @Column({ type: 'boolean', default: false })
    phoneVerified: boolean;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'boolean', default: false })
    hasAvatar: boolean;

    @Column({ type: 'int', default: 1 })
    avatarVersion: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    avatarSmPath: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    avatarMdPath: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    avatarLgPath: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
