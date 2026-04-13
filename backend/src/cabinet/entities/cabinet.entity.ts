import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { ClinicServiceEntity } from '../../services/entities/clinic-service.entity';
import { CabinetDevice } from './cabinet-device.entity';
import { CabinetDoctor } from './cabinet-doctor.entity';

@Entity('cabinets')
export class Cabinet {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 2000, unique: true })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @ManyToMany(() => ClinicServiceEntity, { eager: true })
    @JoinTable({
        name: 'cabinet_services',
        joinColumn: { name: 'cabinetId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'serviceId', referencedColumnName: 'id' },
    })
    services: ClinicServiceEntity[];

    @OneToMany(() => CabinetDevice, (device) => device.cabinet)
    devices: CabinetDevice[];

    @OneToMany(() => CabinetDoctor, (assignment) => assignment.cabinet)
    doctorAssignments: CabinetDoctor[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
