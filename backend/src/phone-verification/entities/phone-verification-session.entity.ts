import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { PhoneVerificationStatus } from '../../common/enums/phone-verification-status.enum';

@Entity('phone_verification_sessions')
export class PhoneVerificationSession {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 30 })
    phone: string;

    @Column({
        type: 'enum',
        enum: PhoneVerificationStatus,
        default: PhoneVerificationStatus.PENDING,
    })
    status: PhoneVerificationStatus;

    @Column({ type: 'varchar', length: 255, nullable: true })
    telegramBotUrl: string | null;

    @Column({ type: 'bigint', nullable: true })
    telegramUserId: string | null;

    @Column({ type: 'bigint', nullable: true })
    telegramChatId: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    telegramUsername: string | null;

    @Column({ type: 'datetime', nullable: true })
    verifiedAt: Date | null;

    @Column({ type: 'datetime' })
    expiresAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}