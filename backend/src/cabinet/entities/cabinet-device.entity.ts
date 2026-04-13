import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Cabinet } from './cabinet.entity';

export enum CabinetDeviceStartMode {
    AUTO_ON_VISIT_START = 'AUTO_ON_VISIT_START',
    MANUAL = 'MANUAL',
}

@Entity('cabinet_devices')
export class CabinetDevice {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'char', length: 36 })
    cabinetId: string;

    @ManyToOne(() => Cabinet, (cabinet) => cabinet.devices, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'cabinetId' })
    cabinet: Cabinet;

    @Column({ type: 'varchar', length: 2000 })
    name: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    cameraDeviceId: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    cameraLabel: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    microphoneDeviceId: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    microphoneLabel: string | null;

    @Column({
        type: 'enum',
        enum: CabinetDeviceStartMode,
        default: CabinetDeviceStartMode.MANUAL,
    })
    startMode: CabinetDeviceStartMode;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;
}
