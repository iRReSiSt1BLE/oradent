import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import AlertToast from '../../../widgets/AlertToast/AlertToast';
import { useI18n } from '../../../shared/i18n/I18nProvider';
import type { AppLanguage } from '../../../shared/i18n/types';
import {
    buildHomeContentImageUrl,
    removeHomeContentImage,
    updateHomeContentBlocks,
    uploadHomeContentImage,
    type HomeContentBlock,
    type HomeContentI18n,
    type HomeImageVariant,
} from '../../../shared/api/homeContentApi';

const LANGS: Array<{ code: AppLanguage; label: string }> = [
    { code: 'ua', label: 'UA' },
    { code: 'en', label: 'EN' },
    { code: 'de', label: 'DE' },
    { code: 'fr', label: 'FR' },
];

const IMAGE_VARIANTS: Array<{ key: HomeImageVariant; label: string; hint: string; previewWidth: number }> = [
    { key: 'desktop', label: 'Desktop', hint: 'широкий слот', previewWidth: 280 },
    { key: 'tablet', label: 'Tablet', hint: 'планшетний слот', previewWidth: 240 },
    { key: 'mobile', label: 'Mobile', hint: 'мобільний слот', previewWidth: 180 },
];

const BLOCK_META: Record<string, { label: HomeContentI18n; kind: HomeContentI18n }> = {
    hero: {
        label: { ua: 'Головний заголовок', en: 'Hero heading', de: 'Hauptblock', fr: 'Bloc principal' },
        kind: { ua: 'Центрований вступ', en: 'Centered intro', de: 'Zentrierter Introblock', fr: 'Introduction centrée' },
    },
    about: {
        label: { ua: 'Підхід клініки', en: 'Clinic approach', de: 'Ansatz der Klinik', fr: 'Approche de la clinique' },
        kind: { ua: 'Текст + фото', en: 'Text + image', de: 'Text + Bild', fr: 'Texte + image' },
    },
    doctorsIntro: {
        label: { ua: 'Заголовок перед лікарями', en: 'Doctors heading', de: 'Überschrift vor Ärzten', fr: 'Titre avant les médecins' },
        kind: { ua: 'Текст перед секцією лікарів', en: 'Text before doctors', de: 'Text vor Ärzten', fr: 'Texte avant médecins' },
    },
    servicesIntro: {
        label: { ua: 'Заголовок перед послугами', en: 'Services heading', de: 'Überschrift vor Leistungen', fr: 'Titre avant les services' },
        kind: { ua: 'Текст перед секцією послуг', en: 'Text before services', de: 'Text vor Leistungen', fr: 'Texte avant services' },
    },
    process: {
        label: { ua: 'Кроки візиту', en: 'Visit steps', de: 'Schritte des Besuchs', fr: 'Étapes de la visite' },
        kind: { ua: 'Картки з етапами', en: 'Step cards', de: 'Schrittkarten', fr: 'Cartes d’étapes' },
    },
    technology: {
        label: { ua: 'Обстеження і точність', en: 'Diagnostics and precision', de: 'Diagnostik und Präzision', fr: 'Diagnostic et précision' },
        kind: { ua: 'Текст + фото', en: 'Text + image', de: 'Text + Bild', fr: 'Texte + image' },
    },
    comfort: {
        label: { ua: 'Комфорт пацієнта', en: 'Patient comfort', de: 'Patientenkomfort', fr: 'Confort du patient' },
        kind: { ua: 'Текст + фото', en: 'Text + image', de: 'Text + Bild', fr: 'Texte + image' },
    },
    cta: {
        label: { ua: 'Заклик до запису', en: 'Call to action', de: 'Handlungsaufruf', fr: 'Appel à l’action' },
        kind: { ua: 'Фінальний акцент', en: 'Final accent', de: 'Abschlussblock', fr: 'Accent final' },
    },
    footer: {
        label: { ua: 'Футер', en: 'Footer', de: 'Footer', fr: 'Pied de page' },
        kind: { ua: 'Нижня частина сторінки', en: 'Bottom section', de: 'Unterer Seitenbereich', fr: 'Bas de page' },
    },
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const MOVE_STEP = 18;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function copyI18n(value: HomeContentI18n | undefined): HomeContentI18n {
    return {
        ua: value?.ua || '',
        en: value?.en || '',
        de: value?.de || '',
        fr: value?.fr || '',
    };
}

function cloneBlocks(blocks: HomeContentBlock[]): HomeContentBlock[] {
    return blocks
        .map((block) => ({
            ...block,
            eyebrow: copyI18n(block.eyebrow),
            title: copyI18n(block.title),
            subtitle: copyI18n(block.subtitle),
            body: copyI18n(block.body),
            buttonLabel: copyI18n(block.buttonLabel),
            imageAlt: copyI18n(block.imageAlt),
            items: (block.items || []).map((item) => ({
                title: copyI18n(item.title),
                text: copyI18n(item.text),
            })),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

function normalizeSortOrders(blocks: HomeContentBlock[]) {
    return blocks.map((block, index) => ({ ...block, sortOrder: (index + 1) * 10 }));
}

function moveBlock(blocks: HomeContentBlock[], fromKey: string, toKey: string) {
    const fromIndex = blocks.findIndex((block) => block.key === fromKey);
    const toIndex = blocks.findIndex((block) => block.key === toKey);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return blocks;

    const next = [...blocks];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return normalizeSortOrders(next);
}

function pickText(value: HomeContentI18n | undefined, lang: AppLanguage) {
    return value?.[lang] || value?.ua || value?.en || value?.de || value?.fr || '';
}

async function translateText(text: string, from: AppLanguage, to: AppLanguage) {
    const source = text.trim();
    if (!source) return '';
    if (from === to) return source;

    const sourceLang = from === 'ua' ? 'uk' : from;
    const targetLang = to === 'ua' ? 'uk' : to;

    const endpoints = [
        'https://translate.argosopentech.com/translate',
        'https://libretranslate.de/translate',
    ];

    for (const url of endpoints) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: source,
                    source: sourceLang,
                    target: targetLang,
                    format: 'text',
                }),
            });

            if (!resp.ok) continue;
            const data = (await resp.json()) as { translatedText?: string };
            const translated = (data.translatedText || '').trim();
            if (translated) return translated;
        } catch {
        }
    }

    try {
        const query = new URLSearchParams({ q: source, langpair: `${sourceLang}|${targetLang}` });
        const resp = await fetch(`https://api.mymemory.translated.net/get?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as { responseData?: { translatedText?: string } };
            const translated = (data.responseData?.translatedText || '').trim();
            if (translated) return translated;
        }
    } catch {
    }

    throw new Error('translation_unavailable');
}

type HomeContentManagerProps = {
    token: string;
    blocks: HomeContentBlock[];
    onClose: () => void;
    onChanged: (blocks: HomeContentBlock[]) => void;
};

type AlertState = {
    id: string;
    variant: 'success' | 'error' | 'info';
    message: string;
};

export default function HomeContentManager({ token, blocks, onClose, onChanged }: HomeContentManagerProps) {
    const { t } = useI18n();
    const [draftBlocks, setDraftBlocks] = useState<HomeContentBlock[]>(() => cloneBlocks(blocks));
    const [selectedKey, setSelectedKey] = useState(blocks[0]?.key || 'hero');
    const [activeLang, setActiveLang] = useState<AppLanguage>('ua');
    const [saving, setSaving] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [alerts, setAlerts] = useState<AlertState[]>([]);
    const [draggedKey, setDraggedKey] = useState<string | null>(null);
    const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorVariant, setEditorVariant] = useState<HomeImageVariant>('desktop');
    const [editorImageUrl, setEditorImageUrl] = useState('');
    const [editorImage, setEditorImage] = useState<HTMLImageElement | null>(null);
    const [editorScale, setEditorScale] = useState(1);
    const [editorX, setEditorX] = useState(0);
    const [editorY, setEditorY] = useState(0);

    const dragPointerIdRef = useRef<number | null>(null);
    const dragStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    function pushAlert(alert: Omit<AlertState, 'id'>) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setAlerts((prev) => [...prev, { ...alert, id }].slice(-5));
    }

    function removeAlert(id: string) {
        setAlerts((prev) => prev.filter((item) => item.id !== id));
    }

    useEffect(() => {
        setDraftBlocks(cloneBlocks(blocks));
        setSelectedKey((current) => (blocks.some((block) => block.key === current) ? current : blocks[0]?.key || 'hero'));
    }, [blocks]);

    useEffect(() => {
        return () => {
            if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
        };
    }, [editorImageUrl]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        const previousPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        }

        return () => {
            document.body.style.overflow = previousOverflow;
            document.body.style.paddingRight = previousPaddingRight;
        };
    }, []);

    const selectedBlock = useMemo(
        () => draftBlocks.find((block) => block.key === selectedKey) || draftBlocks[0],
        [draftBlocks, selectedKey],
    );

    const imageSpec = selectedBlock?.imageSlots?.[editorVariant] || { width: 1440, height: 900, quality: 84 };
    const frameW = Math.min(520, Math.max(260, imageSpec.width / 2.4));
    const frameH = frameW * (imageSpec.height / imageSpec.width);
    const showImageEditor = Boolean(selectedBlock && selectedBlock.kind === 'split' && selectedBlock.key !== 'hero');
    const showItemsEditor = Boolean(selectedBlock && (selectedBlock.kind === 'steps' || selectedBlock.key === 'about'));
    const showBodyEditor = Boolean(selectedBlock && ['split', 'intro', 'footer'].includes(selectedBlock.kind));

    const frameMetrics = useMemo(() => {
        if (!editorImage) {
            return { renderW: frameW, renderH: frameH, maxX: 0, maxY: 0 };
        }

        const baseScale = Math.max(frameW / editorImage.width, frameH / editorImage.height);
        const renderW = editorImage.width * baseScale * editorScale;
        const renderH = editorImage.height * baseScale * editorScale;
        const maxX = Math.max(0, (renderW - frameW) / 2);
        const maxY = Math.max(0, (renderH - frameH) / 2);

        return { renderW, renderH, maxX, maxY };
    }, [editorImage, editorScale, frameW, frameH]);

    useEffect(() => {
        setEditorX((prev) => clamp(prev, -frameMetrics.maxX, frameMetrics.maxX));
        setEditorY((prev) => clamp(prev, -frameMetrics.maxY, frameMetrics.maxY));
    }, [frameMetrics.maxX, frameMetrics.maxY]);

    function setBlockValue<K extends keyof HomeContentBlock>(key: K, value: HomeContentBlock[K]) {
        if (!selectedBlock) return;
        setDraftBlocks((prev) => prev.map((block) => (block.key === selectedBlock.key ? { ...block, [key]: value } : block)));
    }

    function updateI18nField(field: 'eyebrow' | 'title' | 'subtitle' | 'body' | 'imageAlt', value: string) {
        if (!selectedBlock) return;
        setDraftBlocks((prev) => prev.map((block) => {
            if (block.key !== selectedBlock.key) return block;
            return {
                ...block,
                [field]: {
                    ...copyI18n(block[field]),
                    [activeLang]: value,
                },
            };
        }));
    }

    function updateItem(index: number, field: 'title' | 'text', value: string) {
        if (!selectedBlock) return;
        setDraftBlocks((prev) => prev.map((block) => {
            if (block.key !== selectedBlock.key) return block;
            return {
                ...block,
                items: (block.items || []).map((item, itemIndex) => {
                    if (itemIndex !== index) return item;
                    return {
                        ...item,
                        [field]: {
                            ...copyI18n(item[field]),
                            [activeLang]: value,
                        },
                    };
                }),
            };
        }));
    }

    function addItem() {
        if (!selectedBlock) return;
        setBlockValue('items', [
            ...(selectedBlock.items || []),
            { title: { ua: '', en: '', de: '', fr: '' }, text: { ua: '', en: '', de: '', fr: '' } },
        ]);
    }

    function removeItem(index: number) {
        if (!selectedBlock) return;
        setBlockValue('items', (selectedBlock.items || []).filter((_, itemIndex) => itemIndex !== index));
    }

    function startSidebarDrag(event: DragEvent<HTMLButtonElement>, key: string) {
        setDraggedKey(key);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', key);
    }

    function onSidebarDragOver(event: DragEvent<HTMLButtonElement>, key: string) {
        event.preventDefault();
        if (draggedKey && draggedKey !== key) {
            setDropTargetKey(key);
        }
    }

    function onSidebarDrop(event: DragEvent<HTMLButtonElement>, key: string) {
        event.preventDefault();
        const sourceKey = event.dataTransfer.getData('text/plain') || draggedKey;
        if (!sourceKey || sourceKey === key) {
            setDraggedKey(null);
            setDropTargetKey(null);
            return;
        }
        setDraftBlocks((prev) => moveBlock(prev, sourceKey, key));
        setDraggedKey(null);
        setDropTargetKey(null);
    }

    async function handleSave() {
        setSaving(true);
        setAlerts([]);

        try {
            const response = await updateHomeContentBlocks(token, {
                blocks: draftBlocks.map((block) => ({
                    key: block.key,
                    isActive: block.isActive,
                    sortOrder: block.sortOrder,
                    eyebrow: block.eyebrow,
                    title: block.title,
                    subtitle: block.subtitle,
                    body: block.body,
                    buttonLabel: block.buttonLabel,
                    buttonHref: block.buttonHref,
                    items: block.items,
                    imageAlt: block.imageAlt,
                })),
            });
            onChanged(response.blocks);
            setDraftBlocks(cloneBlocks(response.blocks));
            onClose();
        } catch (err) {
            pushAlert({ variant: 'error', message: err instanceof Error ? err.message : t('homeContentManager.saveError') });
        } finally {
            setSaving(false);
        }
    }

    async function translateSelectedBlock() {
        if (!selectedBlock) return;
        const from = activeLang;
        const targets = LANGS.map((lang) => lang.code).filter((lang) => lang !== from);

        setTranslating(true);
        setAlerts([]);

        try {
            const nextBlock = structuredClone(selectedBlock) as HomeContentBlock;
            const i18nFields: Array<'eyebrow' | 'title' | 'subtitle' | 'body' | 'imageAlt'> = ['eyebrow', 'title', 'subtitle', 'body', 'imageAlt'];

            for (const field of i18nFields) {
                const source = nextBlock[field]?.[from] || '';
                if (!source.trim()) continue;
                for (const target of targets) {
                    nextBlock[field] = {
                        ...copyI18n(nextBlock[field]),
                        [target]: await translateText(source, from, target),
                    };
                }
            }

            for (let index = 0; index < (nextBlock.items || []).length; index += 1) {
                const item = nextBlock.items[index];
                for (const field of ['title', 'text'] as const) {
                    const source = item[field]?.[from] || '';
                    if (!source.trim()) continue;
                    for (const target of targets) {
                        item[field] = {
                            ...copyI18n(item[field]),
                            [target]: await translateText(source, from, target),
                        };
                    }
                }
            }

            setDraftBlocks((prev) => prev.map((block) => (block.key === selectedBlock.key ? nextBlock : block)));
            pushAlert({ variant: 'success', message: t('homeContentManager.translateDone') });
        } catch {
            pushAlert({ variant: 'error', message: t('homeContentManager.translateError') });
        } finally {
            setTranslating(false);
        }
    }

    async function openEditorWithFile(file: File, variant: HomeImageVariant) {
        if (!selectedBlock) return;
        if (!file.type.startsWith('image/')) {
            pushAlert({ variant: 'error', message: t('homeContentManager.imagesOnly') });
            return;
        }

        const url = URL.createObjectURL(file);
        const img = new Image();
        img.decoding = 'async';

        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(t('homeContentManager.readImageError')));
            img.src = url;
        });

        if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
        setEditorImageUrl(url);
        setEditorImage(img);
        setEditorScale(1);
        setEditorX(0);
        setEditorY(0);
        setEditorVariant(variant);
        setEditorOpen(true);
    }

    function closeEditor() {
        setEditorOpen(false);
        setEditorScale(1);
        setEditorX(0);
        setEditorY(0);
        setEditorImage(null);
        if (editorImageUrl) {
            URL.revokeObjectURL(editorImageUrl);
            setEditorImageUrl('');
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function clampPosition(nextX: number, nextY: number) {
        return {
            x: clamp(nextX, -frameMetrics.maxX, frameMetrics.maxX),
            y: clamp(nextY, -frameMetrics.maxY, frameMetrics.maxY),
        };
    }

    function startDrag(e: PointerEvent<HTMLDivElement>) {
        if (dragPointerIdRef.current !== null) return;
        dragPointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            originX: editorX,
            originY: editorY,
        };
    }

    function onDrag(e: PointerEvent<HTMLDivElement>) {
        if (dragPointerIdRef.current !== e.pointerId) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const next = clampPosition(dragStartRef.current.originX + dx, dragStartRef.current.originY + dy);
        setEditorX(next.x);
        setEditorY(next.y);
    }

    function endDrag(e: PointerEvent<HTMLDivElement>) {
        if (dragPointerIdRef.current !== e.pointerId) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragPointerIdRef.current = null;
    }

    function changeZoom(nextScale: number) {
        setEditorScale(clamp(nextScale, MIN_ZOOM, MAX_ZOOM));
    }

    function moveBy(dx: number, dy: number) {
        const next = clampPosition(editorX + dx, editorY + dy);
        setEditorX(next.x);
        setEditorY(next.y);
    }

    async function handleUploadFromEditor() {
        if (!selectedBlock || !editorImage) return;

        setUploading(true);
        setAlerts([]);

        try {
            const canvas = document.createElement('canvas');
            canvas.width = imageSpec.width;
            canvas.height = imageSpec.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context unavailable');

            const ratio = imageSpec.width / frameW;
            const outRenderW = frameMetrics.renderW * ratio;
            const outRenderH = frameMetrics.renderH * ratio;
            const outX = (imageSpec.width - outRenderW) / 2 + editorX * ratio;
            const outY = (imageSpec.height - outRenderH) / 2 + editorY * ratio;

            ctx.clearRect(0, 0, imageSpec.width, imageSpec.height);
            ctx.drawImage(editorImage, outX, outY, outRenderW, outRenderH);

            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (result) => {
                        if (!result) return reject(new Error(t('homeContentManager.generateImageError')));
                        resolve(result);
                    },
                    'image/webp',
                    0.92,
                );
            });

            const finalFile = new File([blob], `${selectedBlock.key}-${editorVariant}.webp`, { type: 'image/webp' });
            const response = await uploadHomeContentImage(token, selectedBlock.key, editorVariant, finalFile);
            onChanged(response.blocks);
            setDraftBlocks(cloneBlocks(response.blocks));
            pushAlert({ variant: 'success', message: t('homeContentManager.imageUpdated') });
            closeEditor();
        } catch (err) {
            pushAlert({ variant: 'error', message: err instanceof Error ? err.message : t('homeContentManager.uploadImageError') });
        } finally {
            setUploading(false);
        }
    }

    async function openEditorWithExistingImage(variant: HomeImageVariant) {
        if (!selectedBlock?.image?.[variant]) return;

        setUploading(true);
        setAlerts([]);

        try {
            const response = await fetch(buildHomeContentImageUrl(selectedBlock.key, variant, selectedBlock.image.version), {
                cache: 'no-store',
            });
            if (!response.ok) throw new Error(t('homeContentManager.fetchCurrentImageError'));
            const blob = await response.blob();
            const file = new File([blob], `${selectedBlock.key}-${variant}-edit.webp`, { type: blob.type || 'image/webp' });
            await openEditorWithFile(file, variant);
        } catch (err) {
            pushAlert({ variant: 'error', message: err instanceof Error ? err.message : t('homeContentManager.openImageEditError') });
        } finally {
            setUploading(false);
        }
    }

    async function handleRemoveImage(variant: HomeImageVariant) {
        if (!selectedBlock) return;

        setUploading(true);
        setAlerts([]);

        try {
            const response = await removeHomeContentImage(token, selectedBlock.key, variant);
            onChanged(response.blocks);
            setDraftBlocks(cloneBlocks(response.blocks));
            pushAlert({ variant: 'success', message: t('homeContentManager.imageDeleted') });
        } catch (err) {
            pushAlert({ variant: 'error', message: err instanceof Error ? err.message : t('homeContentManager.deleteImageError') });
        } finally {
            setUploading(false);
        }
    }

    if (!selectedBlock) return null;

    return (
        <div className="home-content-manager" role="dialog" aria-modal="true">
            <div className="home-content-manager__panel">
                <div className="home-content-manager__head">
                    <div>
                        <p>{t('homeContentManager.kicker')}</p>
                        <h2>{t('homeContentManager.title')}</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
                </div>

                {alerts.map((alert) => (
                    <AlertToast
                        key={alert.id}
                        variant={alert.variant}
                        message={alert.message}
                        onClose={() => removeAlert(alert.id)}
                    />
                ))}

                <div className="home-content-manager__body">
                    <aside className="home-content-manager__sidebar">
                        <p className="home-content-manager__sidebar-note">{t('homeContentManager.dragHint')}</p>
                        {draftBlocks.map((block) => {
                            const meta = BLOCK_META[block.key];
                            const label = meta ? pickText(meta.label, activeLang) : block.key;
                            const kind = meta ? pickText(meta.kind, activeLang) : block.kind;
                            return (
                                <button
                                    key={block.key}
                                    type="button"
                                    draggable
                                    className={[
                                        block.key === selectedBlock.key ? 'is-active' : '',
                                        draggedKey === block.key ? 'is-dragging' : '',
                                        dropTargetKey === block.key ? 'is-drop-target' : '',
                                    ].filter(Boolean).join(' ')}
                                    onClick={() => setSelectedKey(block.key)}
                                    onDragStart={(event) => startSidebarDrag(event, block.key)}
                                    onDragOver={(event) => onSidebarDragOver(event, block.key)}
                                    onDrop={(event) => onSidebarDrop(event, block.key)}
                                    onDragEnd={() => {
                                        setDraggedKey(null);
                                        setDropTargetKey(null);
                                    }}
                                >
                                    <span>{label}</span>
                                    <small>{kind}</small>
                                </button>
                            );
                        })}
                    </aside>

                    <section className="home-content-manager__editor">
                        <div className="home-content-manager__toolbar">
                            <div className="home-content-manager__langs">
                                {LANGS.map((lang) => (
                                    <button
                                        key={lang.code}
                                        type="button"
                                        className={activeLang === lang.code ? 'is-active' : ''}
                                        onClick={() => setActiveLang(lang.code)}
                                    >
                                        {lang.label}
                                    </button>
                                ))}
                            </div>
                            <button type="button" onClick={translateSelectedBlock} disabled={translating}>
                                {translating ? t('homeContentManager.translating') : `${t('homeContentManager.autoTranslateFrom')} ${activeLang.toUpperCase()}`}
                            </button>
                        </div>

                        <div className="home-content-manager__settings-row">
                            <label className="home-content-manager__check">
                                <input
                                    type="checkbox"
                                    checked={selectedBlock.isActive}
                                    onChange={(e) => setBlockValue('isActive', e.target.checked)}
                                />
                                <span>{t('homeContentManager.showBlock')}</span>
                            </label>
                        </div>

                        <label className="home-content-manager__field">
                            <span>{t('homeContentManager.eyebrow')}</span>
                            <input
                                value={selectedBlock.eyebrow?.[activeLang] || ''}
                                onChange={(e) => updateI18nField('eyebrow', e.target.value)}
                                placeholder={t('homeContentManager.eyebrowPlaceholder')}
                            />
                        </label>

                        <label className="home-content-manager__field">
                            <span>{t('homeContentManager.heading')}</span>
                            <textarea
                                value={selectedBlock.title?.[activeLang] || ''}
                                onChange={(e) => updateI18nField('title', e.target.value)}
                                rows={3}
                            />
                        </label>

                        <label className="home-content-manager__field">
                            <span>{t('homeContentManager.subtitle')}</span>
                            <textarea
                                value={selectedBlock.subtitle?.[activeLang] || ''}
                                onChange={(e) => updateI18nField('subtitle', e.target.value)}
                                rows={3}
                            />
                        </label>

                        {showBodyEditor ? (
                            <label className="home-content-manager__field">
                                <span>{t('homeContentManager.body')}</span>
                                <textarea
                                    value={selectedBlock.body?.[activeLang] || ''}
                                    onChange={(e) => updateI18nField('body', e.target.value)}
                                    rows={5}
                                />
                            </label>
                        ) : null}

                        {showItemsEditor ? (
                            <>
                                <div className="home-content-manager__items-head">
                                    <h3>{t('homeContentManager.itemsTitle')}</h3>
                                    <button type="button" onClick={addItem}>{t('homeContentManager.addItem')}</button>
                                </div>

                                <div className="home-content-manager__items">
                                    {(selectedBlock.items || []).map((item, index) => (
                                        <div className="home-content-manager__item" key={`${selectedBlock.key}-${index}`}>
                                            <label>
                                                <span>{t('homeContentManager.itemHeading')}</span>
                                                <input
                                                    value={item.title?.[activeLang] || ''}
                                                    onChange={(e) => updateItem(index, 'title', e.target.value)}
                                                />
                                            </label>
                                            <label>
                                                <span>{t('homeContentManager.itemText')}</span>
                                                <textarea
                                                    value={item.text?.[activeLang] || ''}
                                                    onChange={(e) => updateItem(index, 'text', e.target.value)}
                                                    rows={3}
                                                />
                                            </label>
                                            <button type="button" onClick={() => removeItem(index)}>{t('homeContentManager.removeItem')}</button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : null}

                        {showImageEditor ? (
                            <>
                                <label className="home-content-manager__field">
                                    <span>{t('homeContentManager.imageAlt')}</span>
                                    <input
                                        value={selectedBlock.imageAlt?.[activeLang] || ''}
                                        onChange={(e) => updateI18nField('imageAlt', e.target.value)}
                                    />
                                </label>

                                <div className="home-content-manager__images">
                                    {IMAGE_VARIANTS.map((variant) => {
                                        const spec = selectedBlock.imageSlots?.[variant.key];
                                        const imageVersion = selectedBlock.image?.version;
                                        const imageUrl = selectedBlock.image?.[variant.key]
                                            ? buildHomeContentImageUrl(selectedBlock.key, variant.key, imageVersion)
                                            : '';
                                        return (
                                            <div className="home-content-manager__image-card" key={variant.key}>
                                                <div>
                                                    <strong>{variant.label}</strong>
                                                    <span>{spec?.width || 0}×{spec?.height || 0}px · {variant.hint}</span>
                                                </div>
                                                <div
                                                    className="home-content-manager__image-frame"
                                                    style={{ ['--preview-width' as string]: `${variant.previewWidth}px`, aspectRatio: `${spec?.width || 1} / ${spec?.height || 1}` }}
                                                >
                                                    {imageUrl ? <img src={imageUrl} alt="" /> : <div className="home-content-manager__image-empty">{t('homeContentManager.noImage')}</div>}
                                                </div>
                                                <small>{t('homeContentManager.previewHint')}</small>
                                                <label>
                                                    <span>{t('homeContentManager.upload')}</span>
                                                    <input
                                                        ref={variant.key === 'desktop' ? fileInputRef : undefined}
                                                        type="file"
                                                        accept="image/*"
                                                        disabled={uploading}
                                                        onChange={async (e) => {
                                                            const file = e.target.files?.[0];
                                                            if (!file) return;
                                                            await openEditorWithFile(file, variant.key);
                                                        }}
                                                    />
                                                </label>
                                                <button
                                                    type="button"
                                                    disabled={uploading || !imageUrl}
                                                    onClick={() => openEditorWithExistingImage(variant.key)}
                                                >
                                                    {t('homeContentManager.edit')}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={uploading || !imageUrl}
                                                    onClick={() => handleRemoveImage(variant.key)}
                                                >
                                                    {t('homeContentManager.delete')}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        ) : null}
                    </section>
                </div>

                <div className="home-content-manager__footer">
                    <button type="button" onClick={onClose}>{t('common.close')}</button>
                    <button type="button" onClick={handleSave} disabled={saving}>
                        {saving ? t('homeContentManager.saving') : t('homeContentManager.saveChanges')}
                    </button>
                </div>
            </div>

            {editorOpen && editorImage ? (
                <div className="home-content-manager__crop-backdrop">
                    <div className="home-content-manager__crop-modal">
                        <h3>{t('homeContentManager.imageEditor')} · {editorVariant}</h3>
                        <p>{imageSpec.width}×{imageSpec.height}px. {t('homeContentManager.cropHint')}</p>

                        <div
                            className="home-content-manager__crop-frame"
                            style={{ width: `${frameW}px`, height: `${frameH}px` }}
                            onPointerDown={startDrag}
                            onPointerMove={onDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                        >
                            <img
                                src={editorImageUrl}
                                alt={t('homeContentManager.previewAlt')}
                                draggable={false}
                                style={{
                                    width: `${frameMetrics.renderW}px`,
                                    height: `${frameMetrics.renderH}px`,
                                    left: '50%',
                                    top: '50%',
                                    transform: `translate(calc(-50% + ${editorX}px), calc(-50% + ${editorY}px))`,
                                }}
                            />
                        </div>

                        <div className="home-content-manager__crop-controls">
                            <button type="button" onClick={() => changeZoom(editorScale - 0.15)} disabled={editorScale <= MIN_ZOOM}>−</button>
                            <button type="button" onClick={() => changeZoom(editorScale + 0.15)} disabled={editorScale >= MAX_ZOOM}>+</button>
                            <button type="button" onClick={() => moveBy(-MOVE_STEP, 0)}>←</button>
                            <button type="button" onClick={() => moveBy(MOVE_STEP, 0)}>→</button>
                            <button type="button" onClick={() => moveBy(0, -MOVE_STEP)}>↑</button>
                            <button type="button" onClick={() => moveBy(0, MOVE_STEP)}>↓</button>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditorScale(1);
                                    setEditorX(0);
                                    setEditorY(0);
                                }}
                            >
                                {t('homeContentManager.reset')}
                            </button>
                        </div>

                        <div className="home-content-manager__crop-actions">
                            <button type="button" onClick={closeEditor} disabled={uploading}>{t('common.cancel')}</button>
                            <button type="button" onClick={handleUploadFromEditor} disabled={uploading}>
                                {uploading ? t('homeContentManager.saving') : t('homeContentManager.saveImage')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
