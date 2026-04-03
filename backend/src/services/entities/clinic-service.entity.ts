import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { ServiceCategoryEntity } from './service-category.entity';
import { DoctorSpecialty } from '../../doctor/entities/doctor-specialty.entity';

const decimalToNumber = {
    to: (value: number) => value,
    from: (value: string | number) => Number(value),
};

@Entity('clinic_services')
export class ClinicServiceEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 120, unique: true })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'int', default: 30 })
    durationMinutes: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        transformer: decimalToNumber,
    })
    priceUah: number;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'char', length: 36 })
    categoryId: string;

    @ManyToOne(() => ServiceCategoryEntity, (category) => category.services, {
        nullable: false,
        eager: true,
        onDelete: 'RESTRICT',
    })
    @JoinColumn({ name: 'categoryId' })
    category: ServiceCategoryEntity;

    @ManyToMany(() => DoctorSpecialty, { eager: true })
    @JoinTable({
        name: 'clinic_service_specialties',
        joinColumn: { name: 'serviceId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'specialtyId', referencedColumnName: 'id' },
    })
    specialties: DoctorSpecialty[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}