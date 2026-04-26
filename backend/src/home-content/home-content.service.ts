import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { UserRole } from '../common/enums/user-role.enum';
import { UserService } from '../user/user.service';
import { UpdateHomeContentDto } from './dto/update-home-content.dto';
import {
    HomeContentBlock,
    HomeContentI18n,
    HomeContentItem,
} from './entities/home-content-block.entity';

type HomeImageVariant = 'desktop' | 'tablet' | 'mobile';
type HomeContentDefaultBlock = {
    key: string;
    kind: 'hero' | 'split' | 'steps' | 'intro' | 'cta' | 'footer';
    sortOrder: number;
    isActive: boolean;
    eyebrow?: HomeContentI18n;
    title?: HomeContentI18n;
    subtitle?: HomeContentI18n;
    body?: HomeContentI18n;
    buttonLabel?: HomeContentI18n;
    buttonHref?: string;
    items?: HomeContentItem[];
    imageAlt?: HomeContentI18n;
};

const LANGS: Array<keyof HomeContentI18n> = ['ua', 'en', 'de', 'fr'];
const IMAGE_SPECS: Record<HomeImageVariant, { width: number; height: number; quality: number }> = {
    desktop: { width: 1440, height: 900, quality: 84 },
    tablet: { width: 960, height: 820, quality: 80 },
    mobile: { width: 720, height: 860, quality: 78 },
};

const DEFAULT_BLOCKS: HomeContentDefaultBlock[] = [
    {
        key: 'hero',
        kind: 'hero',
        sortOrder: 10,
        isActive: true,
        eyebrow: {
            ua: 'Стоматологія без зайвого шуму',
            en: 'Dentistry without unnecessary noise',
            de: 'Zahnmedizin ohne unnötige Unruhe',
            fr: 'Dentisterie sans bruit inutile',
        },
        title: {
            ua: 'Oradent — сучасна клініка для планового, точного і спокійного лікування.',
            en: 'Oradent is a modern clinic for planned, precise and calm dental care.',
            de: 'Oradent ist eine moderne Klinik für geplante, präzise und ruhige Zahnbehandlung.',
            fr: 'Oradent est une clinique moderne pour des soins dentaires planifiés, précis et sereins.',
        },
        subtitle: {
            ua: 'Ми поєднуємо цифрову діагностику, зрозумілий план лікування та уважний супровід пацієнта на кожному етапі.',
            en: 'We combine digital diagnostics, a clear treatment plan and attentive patient support at every step.',
            de: 'Wir verbinden digitale Diagnostik, einen klaren Behandlungsplan und aufmerksame Begleitung in jeder Phase.',
            fr: 'Nous associons le diagnostic numérique, un plan de traitement clair et un accompagnement attentif à chaque étape.',
        },
        buttonLabel: {
            ua: 'Записатися на консультацію',
            en: 'Book a consultation',
            de: 'Beratung buchen',
            fr: 'Réserver une consultation',
        },
        buttonHref: '/smart-appointment',
        imageAlt: {
            ua: 'Інтер’єр стоматологічної клініки Oradent',
            en: 'Oradent dental clinic interior',
            de: 'Innenraum der Zahnklinik Oradent',
            fr: 'Intérieur de la clinique dentaire Oradent',
        },
    },
    {
        key: 'about',
        kind: 'split',
        sortOrder: 20,
        isActive: true,
        eyebrow: {
            ua: 'Підхід',
            en: 'Approach',
            de: 'Ansatz',
            fr: 'Approche',
        },
        title: {
            ua: 'Лікування починається з пояснення, а не з поспіху.',
            en: 'Treatment starts with explanation, not haste.',
            de: 'Behandlung beginnt mit Erklärung, nicht mit Eile.',
            fr: 'Le traitement commence par l’explication, pas par la précipitation.',
        },
        body: {
            ua: 'Перед процедурою лікар фіксує скарги, проводить огляд, пояснює варіанти лікування і погоджує послідовність дій. Пацієнт бачить не набір випадкових послуг, а зрозумілий маршрут.',
            en: 'Before a procedure, the doctor records complaints, performs an examination, explains treatment options and agrees the sequence of steps. The patient sees a clear route, not a random set of services.',
            de: 'Vor der Behandlung erfasst der Arzt Beschwerden, untersucht, erklärt Optionen und stimmt die Reihenfolge ab. Der Patient sieht einen klaren Weg statt zufälliger Leistungen.',
            fr: 'Avant une procédure, le médecin note les plaintes, examine, explique les options et valide la séquence. Le patient voit un parcours clair, pas une liste aléatoire de services.',
        },
        items: [
            {
                title: { ua: 'Діагностика', en: 'Diagnostics', de: 'Diagnostik', fr: 'Diagnostic' },
                text: {
                    ua: 'Огляд, фотофіксація та уточнення показань.',
                    en: 'Examination, photo records and indication checks.',
                    de: 'Untersuchung, Fotodokumentation und Indikationsprüfung.',
                    fr: 'Examen, photos et vérification des indications.',
                },
            },
            {
                title: { ua: 'План', en: 'Plan', de: 'Plan', fr: 'Plan' },
                text: {
                    ua: 'Черговість процедур і прогнозований результат.',
                    en: 'Procedure order and expected outcome.',
                    de: 'Ablauf der Verfahren und erwartetes Ergebnis.',
                    fr: 'Ordre des procédures et résultat attendu.',
                },
            },
        ],
        imageAlt: {
            ua: 'Консультація пацієнта у стоматології',
            en: 'Patient consultation in dentistry',
            de: 'Patientenberatung in der Zahnmedizin',
            fr: 'Consultation dentaire du patient',
        },
    },

    {
        key: 'doctorsIntro',
        kind: 'intro',
        sortOrder: 25,
        isActive: true,
        eyebrow: {
            ua: 'Команда',
            en: 'Team',
            de: 'Team',
            fr: 'Équipe',
        },
        title: {
            ua: 'Лікарі сімейної стоматології',
            en: 'Family dentistry doctors',
            de: 'Ärzte der Familienzahnmedizin',
            fr: 'Médecins de dentisterie familiale',
        },
        subtitle: {
            ua: 'Пацієнта супроводжують спеціалісти, які працюють з плановим лікуванням, профілактикою та довгостроковим наглядом.',
            en: 'The patient is supported by specialists who work with planned treatment, prevention and long-term supervision.',
            de: 'Der Patient wird von Spezialisten betreut, die mit geplanter Behandlung, Prävention und langfristiger Begleitung arbeiten.',
            fr: 'Le patient est accompagné par des spécialistes du traitement planifié, de la prévention et du suivi à long terme.',
        },
    },
    {
        key: 'process',
        kind: 'steps',
        sortOrder: 30,
        isActive: true,
        eyebrow: {
            ua: 'Як проходить візит',
            en: 'How a visit works',
            de: 'So läuft ein Besuch ab',
            fr: 'Déroulement de la visite',
        },
        title: {
            ua: 'Чотири кроки, щоб пацієнт розумів, що відбувається.',
            en: 'Four steps so the patient understands what is happening.',
            de: 'Vier Schritte, damit der Patient den Ablauf versteht.',
            fr: 'Quatre étapes pour que le patient comprenne ce qui se passe.',
        },
        items: [
            {
                title: { ua: '01. Запис', en: '01. Booking', de: '01. Termin', fr: '01. Rendez-vous' },
                text: {
                    ua: 'Пацієнт обирає послугу, лікаря або рекомендований варіант запису.',
                    en: 'The patient selects a service, doctor or recommended booking option.',
                    de: 'Der Patient wählt Leistung, Arzt oder empfohlene Terminoption.',
                    fr: 'Le patient choisit un service, un médecin ou une option recommandée.',
                },
            },
            {
                title: { ua: '02. Огляд', en: '02. Examination', de: '02. Untersuchung', fr: '02. Examen' },
                text: {
                    ua: 'Лікар уточнює проблему і формує медично обґрунтований план.',
                    en: 'The doctor clarifies the problem and creates a medically grounded plan.',
                    de: 'Der Arzt klärt das Problem und erstellt einen medizinisch fundierten Plan.',
                    fr: 'Le médecin précise le problème et construit un plan médicalement fondé.',
                },
            },
            {
                title: { ua: '03. Лікування', en: '03. Treatment', de: '03. Behandlung', fr: '03. Traitement' },
                text: {
                    ua: 'Процедури виконуються у правильній послідовності з контролем якості.',
                    en: 'Procedures are performed in the right order with quality control.',
                    de: 'Behandlungen erfolgen in korrekter Reihenfolge mit Qualitätskontrolle.',
                    fr: 'Les procédures sont réalisées dans le bon ordre avec contrôle qualité.',
                },
            },
            {
                title: { ua: '04. Після візиту', en: '04. After the visit', de: '04. Nach dem Besuch', fr: '04. Après la visite' },
                text: {
                    ua: 'Пацієнт отримує рекомендації, висновок і подальші кроки.',
                    en: 'The patient receives recommendations, a conclusion and next steps.',
                    de: 'Der Patient erhält Empfehlungen, Befund und nächste Schritte.',
                    fr: 'Le patient reçoit recommandations, conclusion et prochaines étapes.',
                },
            },
        ],
    },

    {
        key: 'servicesIntro',
        kind: 'intro',
        sortOrder: 35,
        isActive: true,
        eyebrow: {
            ua: 'Послуги',
            en: 'Services',
            de: 'Leistungen',
            fr: 'Services',
        },
        title: {
            ua: 'Наші послуги',
            en: 'Our services',
            de: 'Unsere Leistungen',
            fr: 'Nos services',
        },
        subtitle: {
            ua: 'Ми пропонуємо усі види естетичної та лікувальної стоматології.',
            en: 'We offer all types of aesthetic and therapeutic dentistry.',
            de: 'Wir bieten alle Arten ästhetischer und therapeutischer Zahnmedizin an.',
            fr: 'Nous proposons tous les types de dentisterie esthétique et thérapeutique.',
        },
    },
    {
        key: 'technology',
        kind: 'split',
        sortOrder: 40,
        isActive: true,
        eyebrow: {
            ua: 'Технології',
            en: 'Technology',
            de: 'Technologie',
            fr: 'Technologie',
        },
        title: {
            ua: 'Цифрові інструменти допомагають бачити деталі і не втрачати історію лікування.',
            en: 'Digital tools help us see details and keep the treatment history intact.',
            de: 'Digitale Werkzeuge helfen, Details zu sehen und die Behandlungshistorie zu bewahren.',
            fr: 'Les outils numériques aident à voir les détails et à préserver l’historique des soins.',
        },
        body: {
            ua: 'Клініка може зберігати консультаційні висновки, фото та службові матеріали в єдиній системі. Це спрощує повторні візити й роботу кількох лікарів над одним планом.',
            en: 'The clinic can store consultation notes, photos and internal materials in one system. This simplifies follow-up visits and cooperation between several doctors on one plan.',
            de: 'Die Klinik kann Befunde, Fotos und interne Materialien in einem System speichern. Das erleichtert Folgevisiten und die Zusammenarbeit mehrerer Ärzte.',
            fr: 'La clinique peut conserver conclusions, photos et documents internes dans un seul système. Cela simplifie les visites suivantes et le travail de plusieurs médecins.',
        },
        imageAlt: {
            ua: 'Стоматологічне обладнання та цифрова діагностика',
            en: 'Dental equipment and digital diagnostics',
            de: 'Dentalgeräte und digitale Diagnostik',
            fr: 'Équipement dentaire et diagnostic numérique',
        },
    },
    {
        key: 'comfort',
        kind: 'split',
        sortOrder: 50,
        isActive: true,
        eyebrow: {
            ua: 'Комфорт',
            en: 'Comfort',
            de: 'Komfort',
            fr: 'Confort',
        },
        title: {
            ua: 'Спокійна атмосфера важлива так само, як і технічна точність.',
            en: 'A calm atmosphere matters as much as technical precision.',
            de: 'Eine ruhige Atmosphäre ist ebenso wichtig wie technische Präzision.',
            fr: 'Une atmosphère calme compte autant que la précision technique.',
        },
        body: {
            ua: 'Ми залишаємо пацієнту час на питання, пояснюємо обмеження після процедур і допомагаємо не губитися між етапами лікування.',
            en: 'We leave time for questions, explain post-procedure limits and help patients stay oriented between treatment stages.',
            de: 'Wir lassen Zeit für Fragen, erklären Einschränkungen nach Eingriffen und helfen, zwischen den Etappen den Überblick zu behalten.',
            fr: 'Nous laissons du temps aux questions, expliquons les limites après les actes et aidons le patient à rester orienté.',
        },
        imageAlt: {
            ua: 'Комфортна зона очікування у клініці',
            en: 'Comfortable waiting area in the clinic',
            de: 'Komfortabler Wartebereich in der Klinik',
            fr: 'Espace d’attente confortable dans la clinique',
        },
    },
    {
        key: 'cta',
        kind: 'cta',
        sortOrder: 60,
        isActive: true,
        title: {
            ua: 'Потрібна консультація або план лікування?',
            en: 'Need a consultation or treatment plan?',
            de: 'Benötigen Sie eine Beratung oder einen Behandlungsplan?',
            fr: 'Besoin d’une consultation ou d’un plan de traitement ?',
        },
        subtitle: {
            ua: 'Оберіть послугу в каталозі або перейдіть до розумного запису — система допоможе підібрати послідовність процедур.',
            en: 'Choose a service in the catalog or go to smart booking — the system will help build a procedure sequence.',
            de: 'Wählen Sie eine Leistung im Katalog oder nutzen Sie die intelligente Buchung — das System hilft bei der Reihenfolge.',
            fr: 'Choisissez un service dans le catalogue ou passez à la réservation intelligente — le système aide à organiser les étapes.',
        },
        buttonLabel: {
            ua: 'Перейти до запису',
            en: 'Go to booking',
            de: 'Zur Buchung',
            fr: 'Passer au rendez-vous',
        },
        buttonHref: '/smart-appointment',
    },
    {
        key: 'footer',
        kind: 'footer',
        sortOrder: 70,
        isActive: true,
        title: {
            ua: 'Oradent',
            en: 'Oradent',
            de: 'Oradent',
            fr: 'Oradent',
        },
        subtitle: {
            ua: 'Стоматологічна клініка для планового лікування, профілактики та довгострокового супроводу.',
            en: 'Dental clinic for planned treatment, prevention and long-term support.',
            de: 'Zahnklinik für geplante Behandlung, Prävention und langfristige Betreuung.',
            fr: 'Clinique dentaire pour traitement planifié, prévention et suivi à long terme.',
        },
        body: {
            ua: '© Oradent. Медична інформація на сайті не замінює консультацію лікаря.',
            en: '© Oradent. Medical information on the site does not replace a doctor consultation.',
            de: '© Oradent. Medizinische Informationen auf der Website ersetzen keine ärztliche Beratung.',
            fr: '© Oradent. Les informations médicales du site ne remplacent pas une consultation.',
        },
    },
];

@Injectable()
export class HomeContentService {
    constructor(
        @InjectRepository(HomeContentBlock)
        private readonly blockRepository: Repository<HomeContentBlock>,
        private readonly userService: UserService,
        private readonly configService: ConfigService,
    ) {}

    private normalizeI18n(value: unknown, fallback: HomeContentI18n = {}): HomeContentI18n {
        const source = value && typeof value === 'object' ? (value as HomeContentI18n) : {};
        const result: HomeContentI18n = {};

        for (const lang of LANGS) {
            const next = typeof source[lang] === 'string' ? source[lang] : fallback[lang] || '';
            result[lang] = next.slice(0, 12000);
        }

        return result;
    }

    private normalizeItems(value: unknown, fallback: HomeContentItem[] = []): HomeContentItem[] {
        if (!Array.isArray(value)) return fallback;

        return value.slice(0, 12).map((item, index) => {
            const fallbackItem = fallback[index];
            return {
                title: this.normalizeI18n(item?.title, fallbackItem?.title || {}),
                text: this.normalizeI18n(item?.text, fallbackItem?.text || {}),
            };
        });
    }

    private async ensureManagerAccess(currentUserId: string) {
        const user = await this.userService.findById(currentUserId);

        if (!user) {
            throw new ForbiddenException('Користувача не знайдено');
        }

        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Доступ лише для адміністраторів');
        }
    }

    private getStorageRoot() {
        const configured = this.configService.get<string>('HOME_CONTENT_STORAGE_ROOT');
        if (configured && configured.trim().length > 0) {
            return configured.trim();
        }

        if (process.platform === 'win32') {
            return 'C:\\Users\\hmax0\\Desktop\\oradent-storage\\home-content';
        }

        return '/home/u569589412/home-content';
    }

    private buildImageUrl(key: string, variant: HomeImageVariant, version: number) {
        return `/home-content/blocks/${key}/image?variant=${variant}&v=${version}`;
    }

    private getDefaultByKey(key: string) {
        return DEFAULT_BLOCKS.find((block) => block.key === key);
    }

    private async ensureDefaultBlocks() {
        for (const defaults of DEFAULT_BLOCKS) {
            const existing = await this.blockRepository.findOne({ where: { key: defaults.key } });
            if (existing) continue;

            const created = this.blockRepository.create({
                key: defaults.key,
                kind: defaults.kind,
                sortOrder: defaults.sortOrder,
                isActive: defaults.isActive,
                eyebrow: defaults.eyebrow || {},
                title: defaults.title || {},
                subtitle: defaults.subtitle || {},
                body: defaults.body || {},
                buttonLabel: defaults.buttonLabel || {},
                buttonHref: defaults.buttonHref || null,
                items: defaults.items || [],
                imageAlt: defaults.imageAlt || {},
                hasImage: false,
                imageVersion: 1,
                imageDesktopPath: null,
                imageTabletPath: null,
                imageMobilePath: null,
            });

            await this.blockRepository.save(created);
        }
    }

    private mapBlock(block: HomeContentBlock) {
        return {
            id: block.id,
            key: block.key,
            kind: block.kind,
            sortOrder: block.sortOrder,
            isActive: block.isActive,
            eyebrow: this.normalizeI18n(block.eyebrow || {}),
            title: this.normalizeI18n(block.title || {}),
            subtitle: this.normalizeI18n(block.subtitle || {}),
            body: this.normalizeI18n(block.body || {}),
            buttonLabel: this.normalizeI18n(block.buttonLabel || {}),
            buttonHref: block.buttonHref || '',
            items: this.normalizeItems(block.items || []),
            imageAlt: this.normalizeI18n(block.imageAlt || {}),
            image: block.hasImage
                ? {
                    version: block.imageVersion,
                    desktop: block.imageDesktopPath ? this.buildImageUrl(block.key, 'desktop', block.imageVersion) : '',
                    tablet: block.imageTabletPath ? this.buildImageUrl(block.key, 'tablet', block.imageVersion) : '',
                    mobile: block.imageMobilePath ? this.buildImageUrl(block.key, 'mobile', block.imageVersion) : '',
                }
                : null,
            imageSlots: IMAGE_SPECS,
            updatedAt: block.updatedAt,
        };
    }

    private async getBlocks(includeInactive: boolean) {
        await this.ensureDefaultBlocks();

        const blocks = await this.blockRepository.find({
            order: {
                sortOrder: 'ASC',
                key: 'ASC',
            },
        });

        const filtered = includeInactive ? blocks : blocks.filter((block) => block.isActive);

        return {
            ok: true,
            blocks: filtered.map((block) => this.mapBlock(block)),
        };
    }

    getPublicContent() {
        return this.getBlocks(false);
    }

    async getAdminContent(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);
        return this.getBlocks(true);
    }

    async updateBlocks(currentUserId: string, dto: UpdateHomeContentDto) {
        await this.ensureManagerAccess(currentUserId);
        await this.ensureDefaultBlocks();

        const blocks = Array.isArray(dto.blocks) ? dto.blocks : [];

        for (const payload of blocks) {
            const block = await this.blockRepository.findOne({ where: { key: payload.key } });
            if (!block) continue;

            const defaults = this.getDefaultByKey(block.key);

            if (payload.isActive !== undefined) block.isActive = Boolean(payload.isActive);
            if (payload.sortOrder !== undefined) block.sortOrder = payload.sortOrder;
            if (payload.eyebrow !== undefined) block.eyebrow = this.normalizeI18n(payload.eyebrow, defaults?.eyebrow || {});
            if (payload.title !== undefined) block.title = this.normalizeI18n(payload.title, defaults?.title || {});
            if (payload.subtitle !== undefined) block.subtitle = this.normalizeI18n(payload.subtitle, defaults?.subtitle || {});
            if (payload.body !== undefined) block.body = this.normalizeI18n(payload.body, defaults?.body || {});
            if (payload.buttonLabel !== undefined) block.buttonLabel = this.normalizeI18n(payload.buttonLabel, defaults?.buttonLabel || {});
            if (payload.buttonHref !== undefined) block.buttonHref = payload.buttonHref.trim().slice(0, 255) || null;
            if (payload.items !== undefined) block.items = this.normalizeItems(payload.items, defaults?.items || []);
            if (payload.imageAlt !== undefined) block.imageAlt = this.normalizeI18n(payload.imageAlt, defaults?.imageAlt || {});

            await this.blockRepository.save(block);
        }

        return this.getBlocks(true);
    }

    async uploadImage(
        currentUserId: string,
        key: string,
        variant: HomeImageVariant,
        file: Express.Multer.File,
    ) {
        await this.ensureManagerAccess(currentUserId);
        await this.ensureDefaultBlocks();

        if (!IMAGE_SPECS[variant]) {
            throw new BadRequestException('Невірний розмір зображення');
        }

        const block = await this.blockRepository.findOne({ where: { key } });
        if (!block) {
            throw new NotFoundException('Блок головної сторінки не знайдено');
        }

        if (!file) {
            throw new BadRequestException('Файл не отримано');
        }

        if (!file.mimetype.startsWith('image/')) {
            throw new BadRequestException('Дозволені лише зображення');
        }

        const spec = IMAGE_SPECS[variant];
        const blockDir = path.join(this.getStorageRoot(), block.key);
        fs.mkdirSync(blockDir, { recursive: true });

        const filePath = path.join(blockDir, `${variant}.webp`);

        await sharp(file.buffer)
            .rotate()
            .resize(spec.width, spec.height, { fit: 'cover', position: 'centre' })
            .webp({ quality: spec.quality })
            .toFile(filePath);

        if (variant === 'desktop') block.imageDesktopPath = filePath;
        if (variant === 'tablet') block.imageTabletPath = filePath;
        if (variant === 'mobile') block.imageMobilePath = filePath;

        block.hasImage = Boolean(block.imageDesktopPath || block.imageTabletPath || block.imageMobilePath);
        block.imageVersion = (block.imageVersion || 1) + 1;

        await this.blockRepository.save(block);

        return this.getBlocks(true);
    }

    async removeImage(currentUserId: string, key: string, variant: HomeImageVariant) {
        await this.ensureManagerAccess(currentUserId);
        await this.ensureDefaultBlocks();

        if (!IMAGE_SPECS[variant]) {
            throw new BadRequestException('Невірний розмір зображення');
        }

        const block = await this.blockRepository.findOne({ where: { key } });
        if (!block) {
            throw new NotFoundException('Блок головної сторінки не знайдено');
        }

        const filePath =
            variant === 'desktop'
                ? block.imageDesktopPath
                : variant === 'tablet'
                    ? block.imageTabletPath
                    : block.imageMobilePath;

        if (filePath) {
            try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch {
            }
        }

        if (variant === 'desktop') block.imageDesktopPath = null;
        if (variant === 'tablet') block.imageTabletPath = null;
        if (variant === 'mobile') block.imageMobilePath = null;

        block.hasImage = Boolean(block.imageDesktopPath || block.imageTabletPath || block.imageMobilePath);
        block.imageVersion = (block.imageVersion || 1) + 1;

        await this.blockRepository.save(block);

        return this.getBlocks(true);
    }

    async getImageFile(key: string, variant: HomeImageVariant) {
        await this.ensureDefaultBlocks();

        if (!IMAGE_SPECS[variant]) {
            throw new BadRequestException('Невірний розмір зображення');
        }

        const block = await this.blockRepository.findOne({ where: { key } });
        if (!block || !block.hasImage) {
            throw new NotFoundException('Зображення не знайдено');
        }

        const selectedPath =
            variant === 'desktop'
                ? block.imageDesktopPath
                : variant === 'tablet'
                    ? block.imageTabletPath
                    : block.imageMobilePath;

        const fallbackPath = block.imageDesktopPath || block.imageTabletPath || block.imageMobilePath;
        const filePath = selectedPath || fallbackPath;

        if (!filePath || !fs.existsSync(filePath)) {
            throw new NotFoundException('Зображення не знайдено');
        }

        return {
            filePath,
            contentType: 'image/webp',
            version: block.imageVersion,
        };
    }
}
