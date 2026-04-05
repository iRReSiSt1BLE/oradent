import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { ClinicServiceEntity } from './clinic-service.entity';

@Entity('service_categories')
export class ServiceCategoryEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 700, unique: true })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @OneToMany(() => ClinicServiceEntity, (service) => service.category)
    services: ClinicServiceEntity[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}