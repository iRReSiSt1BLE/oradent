import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Patient } from '../../patient/entities/patient.entity';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { PaymentMethod } from '../../common/enums/payment-method.enum';

@Entity('appointments')
export class Appointment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Patient, (patient) => patient.appointments, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    patient: Patient;

    @Column({ type: 'varchar', length: 100, nullable: true })
    doctorId: string | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    serviceId: string | null;

    @Column({ type: 'datetime', nullable: true })
    appointmentDate: Date | null;

    @Column({ type: 'varchar', length: 50, default: 'BOOKED' })
    status: string;

    @Column({ type: 'varchar', length: 50, default: 'GUEST' })
    source: string;

    @Column({ type: 'boolean', default: false })
    recordingCompleted: boolean;

    @Column({ type: 'datetime', nullable: true })
    recordingCompletedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({
        type: 'enum',
        enum: PaymentStatus,
        default: PaymentStatus.PENDING,
    })
    paymentStatus: PaymentStatus;

    @Column({
        type: 'enum',
        enum: PaymentMethod,
        nullable: true,
    })
    paymentMethod: PaymentMethod | null;

    @Column({ type: 'varchar', length: 80, nullable: true })
    paymentProvider: string | null;

    @Column({ type: 'varchar', length: 180, nullable: true })
    paymentReference: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    paidAmountUah: number | null;

    @Column({ type: 'datetime', nullable: true })
    paidAt: Date | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    receiptNumber: string | null;




    @Column({ type: 'varchar', length: 32, default: 'NONE' })
    refundStatus: 'NONE' | 'PENDING' | 'REFUNDED' | 'FAILED';

    @Column({ type: 'datetime', nullable: true })
    refundRequestedAt: Date | null;

    @Column({ type: 'datetime', nullable: true })
    refundedAt: Date | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    refundAmountUah: number | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    refundReference: string | null;

    @Column({ type: 'datetime', nullable: true })
    cancelledAt: Date | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    cancelReason: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    cancelledByRole: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    cancelledByUserId: string | null;
}
