import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity('video_access_grants')
export class VideoAccessGrant {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: "varchar", length: 100 })
    appointmentId: string;

    @Column({ type: "varchar", length: 100 })
    sharedByDoctorId: string;

    @Column({ type: "varchar", length: 100 })
    sharedWithDoctorId: string;

    @Column({ type: "datetime", nullable: true })
    expiresAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
