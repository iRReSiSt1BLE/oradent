import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

export type HomeContentI18n = {
    ua?: string;
    en?: string;
    de?: string;
    fr?: string;
};

export type HomeContentItem = {
    title: HomeContentI18n;
    text: HomeContentI18n;
};

@Entity('home_content_blocks')
export class HomeContentBlock {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 80, unique: true })
    key: string;

    @Column({ type: 'varchar', length: 40 })
    kind: string;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'simple-json', nullable: true })
    eyebrow: HomeContentI18n | null;

    @Column({ type: 'simple-json', nullable: true })
    title: HomeContentI18n | null;

    @Column({ type: 'simple-json', nullable: true })
    subtitle: HomeContentI18n | null;

    @Column({ type: 'simple-json', nullable: true })
    body: HomeContentI18n | null;

    @Column({ type: 'simple-json', nullable: true })
    buttonLabel: HomeContentI18n | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    buttonHref: string | null;

    @Column({ type: 'simple-json', nullable: true })
    items: HomeContentItem[] | null;

    @Column({ type: 'simple-json', nullable: true })
    imageAlt: HomeContentI18n | null;

    @Column({ type: 'boolean', default: false })
    hasImage: boolean;

    @Column({ type: 'int', default: 1 })
    imageVersion: number;

    @Column({ type: 'varchar', length: 500, nullable: true })
    imageDesktopPath: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    imageTabletPath: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    imageMobilePath: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
