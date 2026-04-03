import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import DoctorCreatePage from '../DoctorCreatePage/DoctorCreatePage';
import {
    buildDoctorAvatarUrl,
    createDoctorSpecialty,
    deleteDoctorSpecialty,
    getAllDoctors,
    getDoctorSpecialties,
    toggleDoctorActive,
    updateDoctorSpecialty,
    type DoctorSpecialtyItem,
} from '../../shared/api/doctorApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import type { AppLanguage } from '../../shared/i18n/translations';
import {
    emptyDoctorSpecialtyLocalized,
    parseDoctorSpecialtyLocalized,
    pickDoctorSpecialtyByLanguage,
    serializeDoctorSpecialtyLocalized,
    type DoctorSpecialtyLocalized,
} from '../../shared/i18n/doctorSpecialty';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './DoctorListPage.scss';

type DoctorItem = {
    id: string;
    userId: string;
    email: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string;
    isActive: boolean;
    hasAvatar: boolean;
    avatarVersion: number;
    avatar: { sm: string; md: string; lg: string } | null;
};

const SPECIALTY_LANGS: AppLanguage[] = ['ua', 'en', 'de', 'fr'];

async function translateText(text: string, from: AppLanguage, to: AppLanguage) {
    const source = text.trim();
    if (!source) return '';
    if (from === to) return source;

    const sourceLang = from === 'ua' ? 'uk' : from;
    const targetLang = to === 'ua' ? 'uk' : to;

    const endpoints = ['https://translate.argosopentech.com/translate', 'https://libretranslate.de/translate'];

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
        const query = new URLSearchParams({
            q: source,
            langpair: `${sourceLang}|${targetLang}`,
        });
        const resp = await fetch(`https://api.mymemory.translated.net/get?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as {
                responseData?: { translatedText?: string };
            };
            const translated = (data.responseData?.translatedText || '').trim();
            if (translated) return translated;
        }
    } catch {
    }

    try {
        const query = new URLSearchParams({
            client: 'gtx',
            sl: sourceLang,
            tl: targetLang,
            dt: 't',
            q: source,
        });
        const resp = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as unknown;
            if (Array.isArray(data) && Array.isArray(data[0])) {
                const translated = data[0]
                    .map((part) => (Array.isArray(part) ? String(part[0] ?? '') : ''))
                    .join('')
                    .trim();
                if (translated) return translated;
            }
        }
    } catch {
    }

    throw new Error('translation_unavailable');
}

export default function DoctorListPage() {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const navigate = useNavigate();
    const { t, language } = useI18n();

    const [doctors, setDoctors] = useState<DoctorItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const [isSpecialtyModalOpen, setIsSpecialtyModalOpen] = useState(false);
    const [isDoctorCreateModalOpen, setIsDoctorCreateModalOpen] = useState(false);

    const [specialties, setSpecialties] = useState<DoctorSpecialtyItem[]>([]);
    const [loadingSpecialties, setLoadingSpecialties] = useState(false);

    const [newSpecialtyLang, setNewSpecialtyLang] = useState<AppLanguage>('ua');
    const [newSpecialtyByLang, setNewSpecialtyByLang] = useState<DoctorSpecialtyLocalized>(() =>
        emptyDoctorSpecialtyLocalized(),
    );

    const [editingById, setEditingById] = useState<Record<string, DoctorSpecialtyLocalized>>({});
    const [editingLangById, setEditingLangById] = useState<Record<string, AppLanguage>>({});

    const [selectedSpecialtyId, setSelectedSpecialtyId] = useState<string | null>(null);

    const [savingSpecialty, setSavingSpecialty] = useState(false);
    const [savingSpecialtyId, setSavingSpecialtyId] = useState<string | null>(null);
    const [deletingSpecialtyId, setDeletingSpecialtyId] = useState<string | null>(null);

    const [translatingNew, setTranslatingNew] = useState(false);
    const [translatingSpecialtyId, setTranslatingSpecialtyId] = useState<string | null>(null);

    const isAnyModalOpen = isSpecialtyModalOpen || isDoctorCreateModalOpen;

    const langLabel: Record<AppLanguage, string> = {
        ua: t('doctorCreate.bioUa'),
        en: t('doctorCreate.bioEn'),
        de: t('doctorCreate.bioDe'),
        fr: t('doctorCreate.bioFr'),
    };

    useEffect(() => {
        void loadDoctors();
    }, []);

    useEffect(() => {
        if (!isAnyModalOpen) return;

        const prevOverflow = document.body.style.overflow;
        const prevTouchAction = document.body.style.touchAction;

        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';

        return () => {
            document.body.style.overflow = prevOverflow;
            document.body.style.touchAction = prevTouchAction;
        };
    }, [isAnyModalOpen]);

    async function loadDoctors() {
        if (!token) {
            setError(t('doctorList.loginRequired'));
            setLoading(false);
            return;
        }

        if (!isAllowed) {
            setLoading(false);
            return;
        }

        try {
            const result = await getAllDoctors(token);
            setDoctors(result.doctors);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorList.loadDoctorsFailed'));
        } finally {
            setLoading(false);
        }
    }

    async function loadSpecialties() {
        if (!token) return;
        setLoadingSpecialties(true);
        try {
            const result = await getDoctorSpecialties(token);
            setSpecialties(result.specialties);

            const localizedMap: Record<string, DoctorSpecialtyLocalized> = {};
            const langMap: Record<string, AppLanguage> = {};
            result.specialties.forEach((s) => {
                localizedMap[s.id] = parseDoctorSpecialtyLocalized(s.name);
                langMap[s.id] = 'ua';
            });

            setEditingById(localizedMap);
            setEditingLangById(langMap);
            setSelectedSpecialtyId((prev) => prev && result.specialties.some((s) => s.id === prev) ? prev : null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorList.loadSpecialtiesFailed'));
        } finally {
            setLoadingSpecialties(false);
        }
    }

    function openSpecialtiesModal() {
        setIsSpecialtyModalOpen(true);
        setSelectedSpecialtyId(null);
        void loadSpecialties();
    }

    function closeSpecialtiesModal() {
        setIsSpecialtyModalOpen(false);
        setSelectedSpecialtyId(null);
        setNewSpecialtyLang('ua');
        setNewSpecialtyByLang(emptyDoctorSpecialtyLocalized());
        setTranslatingNew(false);
        setTranslatingSpecialtyId(null);
    }

    function closeDoctorCreateModal() {
        setIsDoctorCreateModalOpen(false);
        void loadDoctors();
    }

    const filteredDoctors = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return doctors;

        return doctors.filter((doctor) => {
            const fullName = `${doctor.lastName} ${doctor.firstName} ${doctor.middleName || ''}`.toLowerCase();
            return fullName.includes(q);
        });
    }, [doctors, search]);

    const selectedSpecialty = useMemo(
        () => specialties.find((s) => s.id === selectedSpecialtyId) || null,
        [specialties, selectedSpecialtyId],
    );

    const selectedEditLang = selectedSpecialtyId ? editingLangById[selectedSpecialtyId] || 'ua' : 'ua';

    async function handleToggleDoctor(doctorId: string) {
        if (!token) return;

        setMessage('');
        setError('');
        setTogglingId(doctorId);

        try {
            const result = await toggleDoctorActive(token, doctorId);

            setDoctors((prev) =>
                prev.map((item) => (item.id === doctorId ? { ...item, isActive: result.isActive } : item)),
            );

            setMessage(result.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorList.toggleStatusFailed'));
        } finally {
            setTogglingId(null);
        }
    }

    function setNewSpecialtyValue(lang: AppLanguage, value: string) {
        setNewSpecialtyByLang((prev) => ({ ...prev, [lang]: value }));
    }

    function setExistingSpecialtyValue(id: string, lang: AppLanguage, value: string) {
        setEditingById((prev) => {
            const current = prev[id] || emptyDoctorSpecialtyLocalized();
            return { ...prev, [id]: { ...current, [lang]: value } };
        });
    }

    async function handleAutoTranslateNew() {
        const source = newSpecialtyByLang.ua.trim();
        if (!source) {
            setError(t('doctorCreate.enterUkrainianFirst'));
            return;
        }

        setTranslatingNew(true);
        setError('');
        try {
            const [en, de, fr] = await Promise.all([
                translateText(source, 'ua', 'en').catch(() => ''),
                translateText(source, 'ua', 'de').catch(() => ''),
                translateText(source, 'ua', 'fr').catch(() => ''),
            ]);

            setNewSpecialtyByLang((prev) => ({
                ...prev,
                en: en || prev.en,
                de: de || prev.de,
                fr: fr || prev.fr,
            }));
            setMessage(t('doctorCreate.translateDone'));
        } catch {
            setError(t('doctorCreate.translateFail'));
        } finally {
            setTranslatingNew(false);
        }
    }

    async function handleAutoTranslateExisting(id: string) {
        const current = editingById[id];
        if (!current) return;

        const source = current.ua.trim();
        if (!source) {
            setError(t('doctorCreate.enterUkrainianFirst'));
            return;
        }

        setTranslatingSpecialtyId(id);
        setError('');
        try {
            const [en, de, fr] = await Promise.all([
                translateText(source, 'ua', 'en').catch(() => ''),
                translateText(source, 'ua', 'de').catch(() => ''),
                translateText(source, 'ua', 'fr').catch(() => ''),
            ]);

            setEditingById((prev) => ({
                ...prev,
                [id]: {
                    ...prev[id],
                    en: en || prev[id]?.en || '',
                    de: de || prev[id]?.de || '',
                    fr: fr || prev[id]?.fr || '',
                },
            }));
            setMessage(t('doctorCreate.translateDone'));
        } catch {
            setError(t('doctorCreate.translateFail'));
        } finally {
            setTranslatingSpecialtyId(null);
        }
    }

    async function handleCreateSpecialty() {
        if (!token) return;

        const fallbackName =
            newSpecialtyByLang.ua.trim() ||
            newSpecialtyByLang.en.trim() ||
            newSpecialtyByLang.de.trim() ||
            newSpecialtyByLang.fr.trim();

        if (!fallbackName) return;

        setSavingSpecialty(true);
        try {
            const payload: DoctorSpecialtyLocalized = {
                ua: newSpecialtyByLang.ua.trim() || fallbackName,
                en: newSpecialtyByLang.en.trim(),
                de: newSpecialtyByLang.de.trim(),
                fr: newSpecialtyByLang.fr.trim(),
            };

            const res = await createDoctorSpecialty(token, serializeDoctorSpecialtyLocalized(payload));

            setNewSpecialtyByLang(emptyDoctorSpecialtyLocalized());
            setNewSpecialtyLang('ua');
            setSelectedSpecialtyId(res.specialty.id);
            setMessage(`${t('doctorList.specialtyAdded')}: "${pickDoctorSpecialtyByLanguage(res.specialty.name, language)}"`);

            await loadSpecialties();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorList.createSpecialtyFailed'));
        } finally {
            setSavingSpecialty(false);
        }
    }

    async function handleUpdateSpecialty(id: string) {
        if (!token) return;
        const draft = editingById[id];
        if (!draft) return;

        const fallbackName = draft.ua.trim() || draft.en.trim() || draft.de.trim() || draft.fr.trim();
        if (!fallbackName) return;

        setSavingSpecialtyId(id);
        try {
            const payload: DoctorSpecialtyLocalized = {
                ua: draft.ua.trim() || fallbackName,
                en: draft.en.trim(),
                de: draft.de.trim(),
                fr: draft.fr.trim(),
            };

            const res = await updateDoctorSpecialty(token, id, serializeDoctorSpecialtyLocalized(payload));
            setMessage(`${t('doctorList.specialtyUpdated')}: ${pickDoctorSpecialtyByLanguage(res.specialty.name, language)}`);
            await loadSpecialties();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorList.updateSpecialtyFailed'));
        } finally {
            setSavingSpecialtyId(null);
        }
    }

    async function handleDeleteSpecialty(id: string) {
        if (!token) return;

        setDeletingSpecialtyId(id);
        setError('');
        try {
            await deleteDoctorSpecialty(token, id);
            if (selectedSpecialtyId === id) {
                setSelectedSpecialtyId(null);
            }
            setMessage(t('doctorList.specialtyDeleted'));
            await loadSpecialties();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorList.deleteSpecialtyFailed'));
        } finally {
            setDeletingSpecialtyId(null);
        }
    }

    return (
        <div className="page-shell doctor-list-page">
            <div className="container doctor-list-page__container">
                <div className="doctor-list-page__content">
                    {error && (
                        <div className="doctor-list-page__top-alert">
                            <AlertToast message={error} variant="error" onClose={() => setError('')} />
                        </div>
                    )}
                    {message && (
                        <div className="doctor-list-page__top-alert">
                            <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                        </div>
                    )}

                    <section className="doctor-list-page__card">
                        <h1 className="doctor-list-page__title">{t('doctorList.title')}</h1>

                        {isAllowed && (
                            <>
                                <div className="doctor-list-page__toolbar">
                                    <button type="button" className="doctor-list-page__toolbar-btn" onClick={openSpecialtiesModal}>
                                        {t('doctorList.createSpecialties')}
                                    </button>
                                    <button
                                        type="button"
                                        className="doctor-list-page__toolbar-btn doctor-list-page__toolbar-btn--primary"
                                        onClick={() => setIsDoctorCreateModalOpen(true)}
                                    >
                                        {t('doctorCreate.title')}
                                    </button>
                                </div>

                                <div className="doctor-list-page__search-wrap">
                                    <input
                                        className="doctor-list-page__search"
                                        placeholder={t('doctorList.searchPlaceholder')}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                            </>
                        )}

                        {!isAllowed ? (
                            <div className="doctor-list-page__blocked">{t('doctorList.blocked')}</div>
                        ) : loading ? (
                            <div className="doctor-list-page__loading">{t('doctorList.loading')}</div>
                        ) : (
                            <div className="doctor-list-page__list">
                                {filteredDoctors.map((doctor) => (
                                    <article key={doctor.id} className="doctor-list-page__item">
                                        <div className="doctor-list-page__left">
                                            {doctor.hasAvatar ? (
                                                <img
                                                    className="doctor-list-page__mini-avatar"
                                                    src={buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion)}
                                                    alt={`${doctor.lastName} ${doctor.firstName}`}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            ) : (
                                                <div className="doctor-list-page__mini-avatar doctor-list-page__mini-avatar--placeholder">
                                                    {doctor.lastName?.[0] || 'D'}
                                                </div>
                                            )}

                                            <div className="doctor-list-page__meta">
                                                <h3>
                                                    {doctor.lastName} {doctor.firstName} {doctor.middleName || ''}
                                                    <span
                                                        className={`doctor-list-page__status-dot ${
                                                            doctor.isActive ? 'is-active' : 'is-inactive'
                                                        }`}
                                                    />
                                                </h3>
                                                <p>{doctor.email}</p>
                                                <p>{doctor.phone}</p>
                                            </div>
                                        </div>

                                        <div className="doctor-list-page__actions">
                                            <button
                                                type="button"
                                                className="doctor-list-page__action-btn"
                                                onClick={() => handleToggleDoctor(doctor.id)}
                                                disabled={togglingId === doctor.id}
                                            >
                                                {togglingId === doctor.id
                                                    ? t('doctorList.processing')
                                                    : doctor.isActive
                                                        ? t('doctorList.deactivate')
                                                        : t('doctorList.activate')}
                                            </button>

                                            <button
                                                type="button"
                                                className="doctor-list-page__action-btn"
                                                onClick={() => navigate('/admin/doctors/schedule')}
                                            >
                                                Керування графіком
                                            </button>

                                            <button
                                                type="button"
                                                className="doctor-list-page__action-btn"
                                                onClick={() => navigate(`/admin/doctors/${doctor.id}`)}
                                            >
                                                {t('doctorList.profile')}
                                            </button>
                                        </div>
                                    </article>
                                ))}

                                {!filteredDoctors.length && <div className="doctor-list-page__empty">{t('doctorList.emptySearch')}</div>}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {isSpecialtyModalOpen && (
                <div className="doctor-list-page__modal-backdrop" onClick={closeSpecialtiesModal}>
                    <div className="doctor-list-page__modal doctor-list-page__modal--specialties" onClick={(e) => e.stopPropagation()}>
                        <div className="doctor-list-page__modal-head doctor-list-page__modal-head--centered">
                            <h2>{t('doctorList.specialtiesTitle')}</h2>
                            <button
                                type="button"
                                className="doctor-list-page__close-icon"
                                aria-label={t('doctorList.close')}
                                onClick={closeSpecialtiesModal}
                            >
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>

                        <section className="doctor-list-page__specialty-creator">
                            <div className="doctor-list-page__specialty-lang-tabs">
                                {SPECIALTY_LANGS.map((lang) => (
                                    <button
                                        key={lang}
                                        type="button"
                                        className={['doctor-list-page__specialty-lang-btn', newSpecialtyLang === lang ? 'is-active' : ''].filter(Boolean).join(' ')}
                                        onClick={() => setNewSpecialtyLang(lang)}
                                    >
                                        {langLabel[lang]}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    className="doctor-list-page__specialty-auto-btn"
                                    onClick={() => void handleAutoTranslateNew()}
                                    disabled={translatingNew}
                                >
                                    {translatingNew ? '...' : t('doctorCreate.autoTranslate')}
                                </button>
                            </div>

                            <div className="doctor-list-page__specialty-creator-row">
                                <input
                                    value={newSpecialtyByLang[newSpecialtyLang]}
                                    onChange={(e) => setNewSpecialtyValue(newSpecialtyLang, e.target.value)}
                                    placeholder={t('doctorList.newSpecialtyPlaceholder')}
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleCreateSpecialty()}
                                    disabled={
                                        savingSpecialty ||
                                        !(
                                            newSpecialtyByLang.ua.trim() ||
                                            newSpecialtyByLang.en.trim() ||
                                            newSpecialtyByLang.de.trim() ||
                                            newSpecialtyByLang.fr.trim()
                                        )
                                    }
                                >
                                    {savingSpecialty ? '...' : t('doctorList.add')}
                                </button>
                            </div>
                        </section>

                        <section className="doctor-list-page__specialty-tags-wrap">
                            {loadingSpecialties ? (
                                <div className="doctor-list-page__loading">{t('doctorList.loading')}</div>
                            ) : (
                                <div className="doctor-list-page__specialty-tags">
                                    {specialties.map((specialty) => (
                                        <button
                                            key={specialty.id}
                                            type="button"
                                            className={[
                                                'doctor-list-page__specialty-tag',
                                                selectedSpecialtyId === specialty.id ? 'is-active' : '',
                                            ].filter(Boolean).join(' ')}
                                            onClick={() => setSelectedSpecialtyId(specialty.id)}
                                        >
                                            {pickDoctorSpecialtyByLanguage(specialty.name, language)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>

                        {selectedSpecialty && (
                            <section className="doctor-list-page__specialty-editor">
                                <div className="doctor-list-page__specialty-editor-head">
                                    <h3>{pickDoctorSpecialtyByLanguage(selectedSpecialty.name, language)}</h3>
                                    <div className="doctor-list-page__specialty-lang-tabs">
                                        {SPECIALTY_LANGS.map((lang) => (
                                            <button
                                                key={lang}
                                                type="button"
                                                className={[
                                                    'doctor-list-page__specialty-lang-btn',
                                                    selectedEditLang === lang ? 'is-active' : '',
                                                ].filter(Boolean).join(' ')}
                                                onClick={() => setEditingLangById((prev) => ({ ...prev, [selectedSpecialty.id]: lang }))}
                                            >
                                                {langLabel[lang]}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            className="doctor-list-page__specialty-auto-btn"
                                            onClick={() => void handleAutoTranslateExisting(selectedSpecialty.id)}
                                            disabled={translatingSpecialtyId === selectedSpecialty.id}
                                        >
                                            {translatingSpecialtyId === selectedSpecialty.id ? '...' : t('doctorCreate.autoTranslate')}
                                        </button>
                                    </div>
                                </div>

                                <div className="doctor-list-page__specialty-editor-row">
                                    <input
                                        value={editingById[selectedSpecialty.id]?.[selectedEditLang] ?? ''}
                                        onChange={(e) => setExistingSpecialtyValue(selectedSpecialty.id, selectedEditLang, e.target.value)}
                                    />
                                </div>

                                <div className="doctor-list-page__specialty-editor-actions">
                                    <button
                                        type="button"
                                        className="doctor-list-page__specialty-save"
                                        onClick={() => void handleUpdateSpecialty(selectedSpecialty.id)}
                                        disabled={
                                            savingSpecialtyId === selectedSpecialty.id ||
                                            !(
                                                editingById[selectedSpecialty.id]?.ua?.trim() ||
                                                editingById[selectedSpecialty.id]?.en?.trim() ||
                                                editingById[selectedSpecialty.id]?.de?.trim() ||
                                                editingById[selectedSpecialty.id]?.fr?.trim()
                                            )
                                        }
                                    >
                                        {savingSpecialtyId === selectedSpecialty.id ? '...' : t('doctorList.save')}
                                    </button>

                                    <button
                                        type="button"
                                        className="doctor-list-page__specialty-delete"
                                        onClick={() => void handleDeleteSpecialty(selectedSpecialty.id)}
                                        disabled={deletingSpecialtyId === selectedSpecialty.id}
                                    >
                                        {deletingSpecialtyId === selectedSpecialty.id ? '...' : t('doctorList.delete')}
                                    </button>
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            )}

            <div
                className={[
                    'doctor-list-page__modal-backdrop',
                    'doctor-list-page__modal-backdrop--wide',
                    isDoctorCreateModalOpen ? 'is-open' : 'is-closed',
                ].join(' ')}
                onClick={closeDoctorCreateModal}
                aria-hidden={!isDoctorCreateModalOpen}
            >
                <div className="doctor-list-page__modal doctor-list-page__modal--doctor" onClick={(e) => e.stopPropagation()}>
                    <div className="doctor-list-page__modal-head doctor-list-page__modal-head--centered">
                        <h2>{t('doctorCreate.title')}</h2>
                        <button
                            type="button"
                            className="doctor-list-page__close-icon"
                            aria-label={t('doctorList.close')}
                            onClick={closeDoctorCreateModal}
                        >
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div className="doctor-list-page__doctor-modal-body">
                        <DoctorCreatePage
                            embedded
                            onCreated={() => {
                                void loadDoctors();
                                setIsDoctorCreateModalOpen(false);
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
