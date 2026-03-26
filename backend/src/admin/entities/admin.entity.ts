import {
    Column,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity('admins')
export class Admin {
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

    @Column({ type: 'varchar', length: 20 })
    phone: string;

    @Column({ type: 'boolean', default: false })
    phoneVerified: boolean;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;
}