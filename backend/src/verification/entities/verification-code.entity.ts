import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { VerificationType } from '../../common/enums/verification-type.enum';

@Entity('verification_codes')
export class VerificationCode {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    target: string;

    @Column({
        type: 'enum',
        enum: VerificationType,
    })
    type: VerificationType;

    @Column({ type: 'varchar', length: 20 })
    code: string;

    @Column({ type: 'boolean', default: false })
    isUsed: boolean;

    @Column({ type: 'datetime' })
    expiresAt: Date;

    @CreateDateColumn()
    createdAt: Date;
}