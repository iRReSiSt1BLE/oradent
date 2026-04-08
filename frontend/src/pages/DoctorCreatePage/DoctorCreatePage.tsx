import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type FormEvent,
    type KeyboardEvent,
} from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createDoctor,
    getDoctorSpecialties,
    requestDoctorEmailVerification,
    type DoctorSpecialtyItem,
} from '../../shared/api/doctorApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import { useI18n } from '../../shared/i18n/I18nProvider';
import type { AppLanguage } from '../../shared/i18n/types.ts';
import {
    emptyDoctorInfoLocalized,
    serializeDoctorInfoLocalized,
    type DoctorInfoLocalized,
} from '../../shared/i18n/doctorInfo';
import { pickDoctorSpecialtyByLanguage } from '../../shared/i18n/doctorSpecialty';
import './DoctorCreatePage.scss';

type StepId = 'profile' | 'phone' | 'email' | 'confirm';

type DoctorCreatePageProps = {
    embedded?: boolean;
    onCreated?: () => void;
    onClose?: () => void;
};

const STEP_ITEMS: StepId[] = ['profile', 'phone', 'email', 'confirm'];


const EMAIL_COOLDOWN_MS = 3 * 60 * 1000;
const EMAIL_COOLDOWN_KEY = 'doctorCreate.emailCooldown.v7';
const EMAIL_OTP_LENGTH = 6;

const DESCRIPTION_LANGS: AppLanguage[] = ['ua', 'en', 'de', 'fr'];

function generateStrongPassword(length = 14) {
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const all = lower + upper + digits + symbols;

    const chars = [
        lower[Math.floor(Math.random() * lower.length)],
        upper[Math.floor(Math.random() * upper.length)],
        digits[Math.floor(Math.random() * digits.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
    ];

    while (chars.length < length) chars.push(all[Math.floor(Math.random() * all.length)]);

    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
    return value.trim();
}

function formatCooldown(ms: number) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function CheckIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <polyline
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
                points="2.75 8.75 6.25 12.25 13.25 4.75"
            />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#000" fill-rule="evenodd" d="M15 1.25h-4.056c-1.838 0-3.294 0-4.433.153c-1.172.158-2.121.49-2.87 1.238c-.748.749-1.08 1.698-1.238 2.87c-.153 1.14-.153 2.595-.153 4.433V16a3.75 3.75 0 0 0 3.166 3.705c.137.764.402 1.416.932 1.947c.602.602 1.36.86 2.26.982c.867.116 1.97.116 3.337.116h3.11c1.367 0 2.47 0 3.337-.116c.9-.122 1.658-.38 2.26-.982s.86-1.36.982-2.26c.116-.867.116-1.97.116-3.337v-5.11c0-1.367 0-2.47-.116-3.337c-.122-.9-.38-1.658-.982-2.26c-.531-.53-1.183-.795-1.947-.932A3.75 3.75 0 0 0 15 1.25m2.13 3.021A2.25 2.25 0 0 0 15 2.75h-4c-1.907 0-3.261.002-4.29.14c-1.005.135-1.585.389-2.008.812S4.025 4.705 3.89 5.71c-.138 1.029-.14 2.383-.14 4.29v6a2.25 2.25 0 0 0 1.521 2.13c-.021-.61-.021-1.3-.021-2.075v-5.11c0-1.367 0-2.47.117-3.337c.12-.9.38-1.658.981-2.26c.602-.602 1.36-.86 2.26-.981c.867-.117 1.97-.117 3.337-.117h3.11c.775 0 1.464 0 2.074.021M7.408 6.41c.277-.277.665-.457 1.4-.556c.754-.101 1.756-.103 3.191-.103h3c1.435 0 2.436.002 3.192.103c.734.099 1.122.28 1.399.556c.277.277.457.665.556 1.4c.101.754.103 1.756.103 3.191v5c0 1.435-.002 2.436-.103 3.192c-.099.734-.28 1.122-.556 1.399c-.277.277-.665.457-1.4.556c-.755.101-1.756.103-3.191.103h-3c-1.435 0-2.437-.002-3.192-.103c-.734-.099-1.122-.28-1.399-.556c-.277-.277-.457-.665-.556-1.4c-.101-.755-.103-1.756-.103-3.191v-5c0-1.435.002-2.437.103-3.192c.099-.734.28-1.122.556-1.399" clip-rule="evenodd"/></svg>
    );
}

function RefreshIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#000" d="M12.079 2.25c-4.794 0-8.734 3.663-9.118 8.333H2a.75.75 0 0 0-.528 1.283l1.68 1.666a.75.75 0 0 0 1.056 0l1.68-1.666a.75.75 0 0 0-.528-1.283h-.893c.38-3.831 3.638-6.833 7.612-6.833a7.66 7.66 0 0 1 6.537 3.643a.75.75 0 1 0 1.277-.786A9.16 9.16 0 0 0 12.08 2.25m8.761 8.217a.75.75 0 0 0-1.054 0L18.1 12.133a.75.75 0 0 0 .527 1.284h.899c-.382 3.83-3.651 6.833-7.644 6.833a7.7 7.7 0 0 1-6.565-3.644a.75.75 0 1 0-1.277.788a9.2 9.2 0 0 0 7.842 4.356c4.808 0 8.765-3.66 9.15-8.333H22a.75.75 0 0 0 .527-1.284z"/></svg>
    );
}

function EyeIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32"><path fill="#000" d="m20.525 21.94l7.768 7.767a1 1 0 0 0 1.414-1.414l-26-26a1 1 0 1 0-1.414 1.414l5.19 5.19c-3.99 3.15-5.424 7.75-5.444 7.823c-.16.53.14 1.08.67 1.24s1.09-.14 1.25-.67c.073-.254 1.358-4.323 4.926-6.99l3.175 3.175a6 6 0 1 0 8.465 8.465m-4.972-9.924l6.43 6.431Q22 18.225 22 18a6 6 0 0 0-6.447-5.984M10.59 7.053L12.135 8.6a12.2 12.2 0 0 1 3.861-.6c9.105 0 11.915 8.903 12.038 9.29c.13.43.53.71.96.71v-.01a.993.993 0 0 0 .96-1.28C29.923 16.61 26.613 6 15.995 6c-2.07 0-3.862.403-5.406 1.053"/></svg>
    );
}

function EyeOffIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 28 28"><path fill="#000" d="M25.257 16h.005h-.01zm-.705-.52c.1.318.387.518.704.52c.07 0 .148-.02.226-.04c.39-.12.61-.55.48-.94C25.932 14.93 22.932 6 14 6S2.067 14.93 2.037 15.02c-.13.39.09.81.48.94c.4.13.82-.09.95-.48l.003-.005c.133-.39 2.737-7.975 10.54-7.975c7.842 0 10.432 7.65 10.542 7.98M9 16a5 5 0 1 1 10 0a5 5 0 0 1-10 0"/></svg>

    );
}

function getDoctorSpecialtyLabel(
    specialty: DoctorSpecialtyItem | undefined,
    language: AppLanguage,
): string {
    if (!specialty) return '';

    const i18n = (specialty as any).nameI18n;
    if (i18n && typeof i18n === 'object') {
        return i18n[language] || i18n.ua || i18n.en || i18n.de || i18n.fr || specialty.name || '';
    }

    if (typeof specialty.name === 'string') {
        return pickDoctorSpecialtyByLanguage(specialty.name, language) || specialty.name;
    }

    return '';
}

export default function DoctorCreatePage({ embedded = false, onCreated, onClose }: DoctorCreatePageProps) {
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const { t, language } = useI18n();


    const [currentStep, setCurrentStep] = useState(0);
    const [saving, setSaving] = useState(false);
    const [sendingEmailCode, setSendingEmailCode] = useState(false);
    const [startingPhoneVerification, setStartingPhoneVerification] = useState(false);
    const [loadingSpecialties, setLoadingSpecialties] = useState(false);
    const [translating, setTranslating] = useState(false);

    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        phone: '',
        email: '',
    });

    const [descriptionLang, setDescriptionLang] = useState<AppLanguage>(language);
    const [infoByLang, setInfoByLang] = useState<DoctorInfoLocalized>(() => emptyDoctorInfoLocalized());

    const [availableSpecialties, setAvailableSpecialties] = useState<DoctorSpecialtyItem[]>([]);
    const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);

    const [password, setPassword] = useState(() => generateStrongPassword());
    const [showPassword, setShowPassword] = useState(false);
    const [copiedPassword, setCopiedPassword] = useState(false);
    const [isRegeneratingPassword, setIsRegeneratingPassword] = useState(false);

    const pollingRef = useRef<number | null>(null);
    const copiedTimerRef = useRef<number | null>(null);
    const regenerateTimerRef = useRef<number | null>(null);

    const [emailCodeDigits, setEmailCodeDigits] = useState<string[]>(() =>
        Array.from({ length: EMAIL_OTP_LENGTH }, () => ''),
    );
    const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [emailCodeRequested, setEmailCodeRequested] = useState(false);
    const [emailCodeForEmail, setEmailCodeForEmail] = useState('');
    const [emailVerified, setEmailVerified] = useState(false);
    const [emailVerifiedForEmail, setEmailVerifiedForEmail] = useState('');
    const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

    const [emailCooldownUntil, setEmailCooldownUntil] = useState(0);
    const [nowTs, setNowTs] = useState(Date.now());

    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [phoneVerifiedForPhone, setPhoneVerifiedForPhone] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);

    const normalizedEmail = useMemo(() => normalizeEmail(form.email), [form.email]);
    const normalizedPhone = useMemo(() => normalizePhone(form.phone), [form.phone]);
    const emailCode = useMemo(() => emailCodeDigits.join(''), [emailCodeDigits]);
    const cooldownLeftMs = Math.max(0, emailCooldownUntil - nowTs);
    const cooldownActive = cooldownLeftMs > 0;

    const profileStepReady =
        form.lastName.trim().length > 0 &&
        form.firstName.trim().length > 0 &&
        selectedSpecialties.length > 0 &&
        password.trim().length >= 8;

    const phoneStepReady =
        normalizedPhone.length > 0 &&
        phoneVerified &&
        phoneVerificationSessionId.length > 0 &&
        normalizedPhone === phoneVerifiedForPhone;

    const emailStepReady =
        normalizedEmail.length > 0 &&
        emailCodeRequested &&
        emailCode.length === EMAIL_OTP_LENGTH &&
        emailVerified &&
        normalizedEmail === emailCodeForEmail &&
        normalizedEmail === emailVerifiedForEmail;

    const stepLabels: Record<StepId, { short: string; title: string }> = {
        profile: {
            short: t('doctorCreate.step.profile.short'),
            title: t('doctorCreate.step.profile.title'),
        },
        phone: {
            short: t('doctorCreate.step.phone.short'),
            title: t('doctorCreate.step.phone.title'),
        },
        email: {
            short: t('doctorCreate.step.email.short'),
            title: t('doctorCreate.step.email.title'),
        },
        confirm: {
            short: t('doctorCreate.step.confirm.short'),
            title: t('doctorCreate.step.confirm.title'),
        },
    };

    useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        setDescriptionLang(language);
    }, [language]);

    useEffect(() => {
        if (!token || !isAllowed) return;

        async function loadSpecialties() {
            setLoadingSpecialties(true);
            try {
                const res = await getDoctorSpecialties(token);
                setAvailableSpecialties(res.specialties);
            } catch {
                setAvailableSpecialties([]);
            } finally {
                setLoadingSpecialties(false);
            }
        }

        void loadSpecialties();
    }, [token, isAllowed]);

    useEffect(() => {
        const raw = window.localStorage.getItem(EMAIL_COOLDOWN_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as { email: string; until: number };
            if (parsed?.email && parsed?.until && normalizeEmail(parsed.email) === normalizedEmail) {
                setEmailCooldownUntil(parsed.until);
            }
        } catch {
            setEmailCooldownUntil(0);
        }
    }, [normalizedEmail]);

    useEffect(() => {
        if (!emailCodeForEmail && !emailVerifiedForEmail) return;

        const emailChangedAfterRequest = emailCodeForEmail.length > 0 && normalizedEmail !== emailCodeForEmail;
        const emailChangedAfterVerify = emailVerifiedForEmail.length > 0 && normalizedEmail !== emailVerifiedForEmail;

        if (emailChangedAfterRequest || emailChangedAfterVerify) {
            setEmailCodeRequested(false);
            setEmailVerified(false);
            setEmailVerifiedForEmail('');
            setEmailCodeForEmail('');
            setEmailCodeDigits(Array.from({ length: EMAIL_OTP_LENGTH }, () => ''));
            setEmailCooldownUntil(0);
            setIsEmailModalOpen(false);
            window.localStorage.removeItem(EMAIL_COOLDOWN_KEY);
        }
    }, [normalizedEmail, emailCodeForEmail, emailVerifiedForEmail]);

    useEffect(() => {
        if (!phoneVerifiedForPhone) return;
        if (normalizedPhone !== phoneVerifiedForPhone) {
            setPhoneVerified(false);
            setPhoneVerificationSessionId('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);
        }
    }, [normalizedPhone, phoneVerifiedForPhone]);

    useEffect(() => {
        return () => {
            if (pollingRef.current) window.clearInterval(pollingRef.current);
            if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
            if (regenerateTimerRef.current) window.clearTimeout(regenerateTimerRef.current);
        };
    }, []);

    function clearEmailOtp() {
        setEmailCodeDigits(Array.from({ length: EMAIL_OTP_LENGTH }, () => ''));
    }

    function focusOtpInput(index: number) {
        window.setTimeout(() => otpInputRefs.current[index]?.focus(), 0);
    }

    function handleOtpDigitChange(index: number, rawValue: string) {
        const digit = rawValue.replace(/\D/g, '').slice(-1);
        setEmailCodeDigits((prev) => {
            const next = [...prev];
            next[index] = digit;
            return next;
        });

        if (digit && index < EMAIL_OTP_LENGTH - 1) {
            focusOtpInput(index + 1);
        }
    }

    function handleOtpKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Backspace' && !emailCodeDigits[index] && index > 0) {
            focusOtpInput(index - 1);
            return;
        }
        if (e.key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            focusOtpInput(index - 1);
            return;
        }
        if (e.key === 'ArrowRight' && index < EMAIL_OTP_LENGTH - 1) {
            e.preventDefault();
            focusOtpInput(index + 1);
        }
    }

    function handleOtpPaste(e: ClipboardEvent<HTMLDivElement>) {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, EMAIL_OTP_LENGTH);
        if (!pasted) return;

        const next = Array.from({ length: EMAIL_OTP_LENGTH }, (_, i) => pasted[i] ?? '');
        setEmailCodeDigits(next);
        focusOtpInput(Math.min(pasted.length, EMAIL_OTP_LENGTH - 1));
    }

    function addSpecialtyToSelected(value: string): void {
        const specialtyId = value.trim();
        if (!specialtyId) return;

        if (!selectedSpecialties.includes(specialtyId)) {
            setSelectedSpecialties((prev) => [...prev, specialtyId]);
        }
    }

    function removeSpecialtyFromSelected(value: string): void {
        setSelectedSpecialties((prev) => prev.filter((s) => s !== value));
    }

    async function handleCopyPassword() {
        try {
            await navigator.clipboard.writeText(password);
            setCopiedPassword(true);
            if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = window.setTimeout(() => {
                setCopiedPassword(false);
                copiedTimerRef.current = null;
            }, 1800);
        } catch {
            setError(t('doctorCreate.passwordCopyFail'));
        }
    }

    function handleRegeneratePassword() {
        setPassword(generateStrongPassword());
        setCopiedPassword(false);
        setIsRegeneratingPassword(true);

        if (regenerateTimerRef.current) window.clearTimeout(regenerateTimerRef.current);
        regenerateTimerRef.current = window.setTimeout(() => {
            setIsRegeneratingPassword(false);
            regenerateTimerRef.current = null;
        }, 320);
    }

    async function handleAutoTranslateInfo() {
        const sourceUa = infoByLang.ua.trim();
        const sourceCurrent = infoByLang[descriptionLang].trim();
        const sourceText = sourceUa || sourceCurrent;
        const sourceLang: AppLanguage = sourceUa ? 'ua' : descriptionLang;

        if (!sourceText) {
            setError(t('doctorCreate.translateFail'));
            return;
        }

        setTranslating(true);
        setError('');
        setMessage('');

        try {
            const targets = DESCRIPTION_LANGS.filter((lang) => lang !== sourceLang);
            const translated = await Promise.all(
                targets.map(async (target) => {
                    try {
                        const value = await translateText(sourceText, sourceLang, target);
                        return { target, value };
                    } catch {
                        return { target, value: '' };
                    }
                }),
            );

            const next = { ...infoByLang };
            let changed = false;

            translated.forEach(({ target, value }) => {
                const trimmed = value.trim();
                if (trimmed && trimmed !== next[target].trim()) {
                    next[target] = trimmed;
                    changed = true;
                }
            });

            if (!changed) {
                setError(t('doctorCreate.translateFail'));
                return;
            }

            setInfoByLang(next);
            setMessage(t('doctorCreate.translateDone'));
        } catch {
            setError(t('doctorCreate.translateFail'));
        } finally {
            setTranslating(false);
        }
    }


    async function handleRequestEmailCode() {
        if (!token) return;
        if (!normalizedEmail) {
            setError(t('doctorCreate.errorEmailRequired'));
            return;
        }
        if (cooldownActive) return;

        setSendingEmailCode(true);
        setMessage('');
        setError('');

        try {
            const result = await requestDoctorEmailVerification(token, normalizedEmail);
            const until = Date.now() + EMAIL_COOLDOWN_MS;

            setEmailCodeRequested(true);
            setEmailCodeForEmail(normalizedEmail);
            setEmailVerified(false);
            setEmailVerifiedForEmail('');
            setEmailCooldownUntil(until);
            clearEmailOtp();

            window.localStorage.setItem(EMAIL_COOLDOWN_KEY, JSON.stringify({ email: normalizedEmail, until }));
            setMessage(result.message);
            setIsEmailModalOpen(true);
            focusOtpInput(0);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorCreate.errorEmailSendCode'));
        } finally {
            setSendingEmailCode(false);
        }
    }

    function openOrSendEmailOtp() {
        if (!normalizedEmail) {
            setError(t('doctorCreate.errorEmailRequired'));
            return;
        }

        if (!emailCodeRequested || normalizedEmail !== emailCodeForEmail) {
            void handleRequestEmailCode();
            return;
        }

        setIsEmailModalOpen(true);
        focusOtpInput(0);
    }

    function handleConfirmEmailOtp() {
        if (emailCode.length !== EMAIL_OTP_LENGTH) {
            setError(t('doctorCreate.errorOtpIncomplete'));
            return;
        }
        if (!normalizedEmail || normalizedEmail !== emailCodeForEmail) {
            setError(t('doctorCreate.errorEmailChanged'));
            return;
        }

        setEmailVerified(true);
        setEmailVerifiedForEmail(normalizedEmail);
        setIsEmailModalOpen(false);
        setMessage(t('doctorCreate.emailVerified'));
        setError('');
        setCurrentStep(3);
    }

    async function handleStartPhoneVerification() {
        if (!normalizedPhone) {
            setError(t('doctorCreate.errorPhoneRequired'));
            return;
        }

        setStartingPhoneVerification(true);
        setMessage('');
        setError('');

        try {
            const result = await startPhoneVerification(normalizedPhone);

            setPhoneVerificationSessionId(result.sessionId);
            setTelegramBotUrl(result.telegramBotUrl);
            setPhoneVerified(false);
            setIsPhoneModalOpen(true);

            if (pollingRef.current) window.clearInterval(pollingRef.current);

            pollingRef.current = window.setInterval(async () => {
                try {
                    const status = await getPhoneVerificationStatus(result.sessionId);

                    if (status.status === 'VERIFIED') {
                        if (pollingRef.current) {
                            window.clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                        setPhoneVerified(true);
                        setPhoneVerifiedForPhone(normalizedPhone);
                        setTelegramBotUrl('');
                        setIsPhoneModalOpen(false);
                        setMessage(t('doctorCreate.phoneVerified'));
                        setCurrentStep((prev) => (prev < 2 ? 2 : prev));
                    }

                    if (status.status === 'FAILED' || status.status === 'EXPIRED') {
                        if (pollingRef.current) {
                            window.clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                        setPhoneVerified(false);
                        setError(t('doctorCreate.errorPhoneVerifyIncomplete'));
                    }
                } catch {
                    if (pollingRef.current) {
                        window.clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }
                }
            }, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorCreate.errorPhoneStart'));
        } finally {
            setStartingPhoneVerification(false);
        }
    }

    function goNextStep() {
        if (currentStep === 0 && !profileStepReady) {
            setError(t('doctorCreate.errorProfileIncomplete'));
            return;
        }
        if (currentStep === 1 && !phoneStepReady) {
            setError(t('doctorCreate.errorPhoneUnverified'));
            return;
        }
        if (currentStep === 2 && !emailStepReady) {
            if (!emailCodeRequested || normalizedEmail !== emailCodeForEmail) {
                void handleRequestEmailCode();
            } else {
                setIsEmailModalOpen(true);
                focusOtpInput(0);
            }
            setError('');
            return;
        }
        setError('');
        setCurrentStep((prev) => Math.min(STEP_ITEMS.length - 1, prev + 1));
    }

    function goPrevStep() {
        setError('');
        setCurrentStep((prev) => Math.max(0, prev - 1));
    }

    async function handleCreateDoctor(e: FormEvent) {
        e.preventDefault();

        if (!token) return;
        if (!profileStepReady) return setError(t('doctorCreate.errorProfileIncomplete'));
        if (!phoneStepReady) return setError(t('doctorCreate.errorPhoneUnverified'));
        if (!emailStepReady) return setError(t('doctorCreate.errorEmailUnverified'));

        setSaving(true);
        setMessage('');
        setError('');

        try {
            const infoBlockSerialized = serializeDoctorInfoLocalized(infoByLang);

            const result = await createDoctor(token, {
                lastName: form.lastName.trim(),
                firstName: form.firstName.trim(),
                middleName: form.middleName.trim() || undefined,
                specialties: selectedSpecialties,
                infoBlock: infoBlockSerialized,
                email: normalizedEmail,
                phone: normalizedPhone,
                password,
                emailCode: emailCode.trim(),
                phoneVerificationSessionId,
            });

            setForm({
                lastName: '',
                firstName: '',
                middleName: '',
                phone: '',
                email: '',
            });
            setInfoByLang(emptyDoctorInfoLocalized());
            setDescriptionLang(language);
            setSelectedSpecialties([]);
            setPassword(generateStrongPassword());
            setShowPassword(false);
            setCopiedPassword(false);

            clearEmailOtp();
            setEmailCodeRequested(false);
            setEmailCodeForEmail('');
            setEmailVerified(false);
            setEmailVerifiedForEmail('');
            setEmailCooldownUntil(0);
            setIsEmailModalOpen(false);

            setPhoneVerificationSessionId('');
            setPhoneVerified(false);
            setPhoneVerifiedForPhone('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);

            setCurrentStep(0);
            window.localStorage.removeItem(EMAIL_COOLDOWN_KEY);

            setMessage(result.message || t('doctorCreate.successCreated'));
            onCreated?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('doctorCreate.errorCreate'));
        } finally {
            setSaving(false);
        }
    }



    const content = (
        <>
            <section className="doctor-create-page__card">
                <div className="doctor-create-page__header">
                    <h1 className="doctor-create-page__title">{t('doctorCreate.title')}</h1>

                    {onClose && (
                        <button
                            type="button"
                            className="doctor-create-page__close"
                            onClick={onClose}
                            aria-label={t('common.close')}
                        >
                            ×
                        </button>
                    )}
                </div>

                {error && (
                    <div className="doctor-create-page__top-alert">
                        <AlertToast message={error} variant="error" onClose={() => setError('')} />
                    </div>
                )}
                {message && (
                    <div className="doctor-create-page__top-alert">
                        <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                    </div>
                )}

                {!isAllowed ? (
                    <div className="doctor-create-page__blocked">{t('doctorCreate.blocked')}</div>
                ) : (
                    <form className="doctor-create-page__form" onSubmit={handleCreateDoctor}>
                        <div className="doctor-create-page__stepper">
                            {STEP_ITEMS.map((stepId, index) => {
                                const isActive = index === currentStep;
                                const isDone = index < currentStep;
                                const step = stepLabels[stepId];
                                return (
                                    <button
                                        key={stepId}
                                        type="button"
                                        className={[
                                            'doctor-create-page__step',
                                            isActive ? 'is-active' : '',
                                            isDone ? 'is-done' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        onClick={() => {
                                            if (index <= currentStep) setCurrentStep(index);
                                        }}
                                    >
                                        <span className="doctor-create-page__step-index">{isDone ? <CheckIcon /> : index + 1}</span>
                                        <span className="doctor-create-page__step-text">
                                            <span className="doctor-create-page__step-title">{step.short}</span>
                                            <span className="doctor-create-page__step-subtitle">{step.title}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {currentStep === 0 && (
                            <div className="doctor-create-page__panel">
                                <div className="doctor-create-page__panel-title-row">
                                    <h2 className="doctor-create-page__panel-title">{t('doctorCreate.step1.title')}</h2>
                                    {selectedSpecialties.length > 0 && (
                                        <div className="doctor-create-page__chips doctor-create-page__chips--inline">
                                            {selectedSpecialties.map((specialtyId: string) => {
                                                const specialty = availableSpecialties.find((s: DoctorSpecialtyItem) => s.id === specialtyId);

                                                const label = specialty
                                                    ? getDoctorSpecialtyLabel(specialty, language)
                                                    : specialtyId;

                                                return (
                                                    <button
                                                        key={specialtyId}
                                                        type="button"
                                                        className="doctor-create-page__chip"
                                                        onClick={() => removeSpecialtyFromSelected(specialtyId)}
                                                        title={t('doctorCreate.removeSpecialty')}
                                                    >
                                                        <span>{label}</span>
                                                        <span className="doctor-create-page__chip-x">&times;</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="doctor-create-page__grid">
                                    <label className="doctor-create-page__field">
                                        <span>{t('doctorCreate.lastName')}</span>
                                        <input
                                            autoComplete="off"
                                            value={form.lastName}
                                            onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                                        />
                                    </label>

                                    <label className="doctor-create-page__field">
                                        <span>{t('doctorCreate.firstName')}</span>
                                        <input
                                            autoComplete="off"
                                            value={form.firstName}
                                            onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                                        />
                                    </label>

                                    <label className="doctor-create-page__field">
                                        <span>{t('doctorCreate.middleName')}</span>
                                        <input
                                            autoComplete="off"
                                            value={form.middleName}
                                            onChange={(e) => setForm((prev) => ({ ...prev, middleName: e.target.value }))}
                                        />
                                    </label>

                                    <div className="doctor-create-page__field">
                                        <span>{t('doctorCreate.specialties')}</span>
                                        <select
                                            value=""
                                            onChange={(e) => addSpecialtyToSelected(e.target.value)}
                                            disabled={loadingSpecialties}
                                        >
                                            <option value="">{t('doctorCreate.addSpecialty')}</option>
                                            {availableSpecialties.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {getDoctorSpecialtyLabel(s, language)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="doctor-create-page__field doctor-create-page__field--full">
                                        <span>{t('doctorCreate.bioTitle')}</span>

                                        <div className="doctor-create-page__desc-lang-tabs">
                                            {DESCRIPTION_LANGS.map((lang) => (
                                                <button
                                                    key={lang}
                                                    type="button"
                                                    className={`doctor-create-page__desc-lang-tab ${descriptionLang === lang ? 'is-active' : ''}`}
                                                    onClick={() => setDescriptionLang(lang)}
                                                >
                                                    {t(`doctorCreate.bio${lang.toUpperCase().slice(0, 1)}${lang.slice(1)}` as never)}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className="doctor-create-page__desc-translate"
                                                onClick={() => void handleAutoTranslateInfo()}
                                                disabled={translating}
                                            >
                                                {translating ? '...' : t('doctorCreate.autoTranslate')}
                                            </button>
                                        </div>

                                        <textarea
                                            value={infoByLang[descriptionLang]}
                                            onChange={(e) =>
                                                setInfoByLang((prev) => ({ ...prev, [descriptionLang]: e.target.value }))
                                            }
                                            rows={5}
                                        />
                                    </div>

                                    <label className="doctor-create-page__field doctor-create-page__field--full">
                                        <span>{t('doctorCreate.password')}</span>
                                        <div className="doctor-create-page__password-wrap">
                                            <input
                                                autoComplete="new-password"
                                                type={showPassword ? 'text' : 'password'}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                className="doctor-create-page__password-icon"
                                                onClick={() => setShowPassword((prev) => !prev)}
                                                title={showPassword ? t('doctorCreate.passwordHide') : t('doctorCreate.passwordShow')}
                                                aria-label={showPassword ? t('doctorCreate.passwordHide') : t('doctorCreate.passwordShow')}
                                            >
                                                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                            </button>
                                            <button
                                                type="button"
                                                className={[
                                                    'doctor-create-page__password-icon',
                                                    'doctor-create-page__password-icon--refresh',
                                                    isRegeneratingPassword ? 'is-spinning' : '',
                                                ]
                                                    .join(' ')
                                                    .trim()}
                                                onClick={handleRegeneratePassword}
                                                title={t('doctorCreate.passwordGenerate')}
                                                aria-label={t('doctorCreate.passwordGenerate')}
                                            >
                                                <RefreshIcon />
                                            </button>
                                            <button
                                                type="button"
                                                className="doctor-create-page__password-icon doctor-create-page__password-icon--copy"
                                                onClick={handleCopyPassword}
                                                title={t('doctorCreate.passwordCopy')}
                                                aria-label={t('doctorCreate.passwordCopy')}
                                            >
                                                {copiedPassword ? <CheckIcon /> : <CopyIcon />}
                                            </button>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        )}

                        {currentStep === 1 && (
                            <div className="doctor-create-page__panel">
                                <h2 className="doctor-create-page__panel-title">{t('doctorCreate.step2.title')}</h2>

                                <div className="doctor-create-page__grid doctor-create-page__grid--single">
                                    <label className="doctor-create-page__field">
                                        <span>{t('doctorCreate.phone')}</span>
                                        <input
                                            autoComplete="off"
                                            value={form.phone}
                                            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                                            placeholder="+380..."
                                        />
                                    </label>
                                </div>

                                <div className="doctor-create-page__verify-row doctor-create-page__verify-row--single">
                                    <button
                                        type="button"
                                        onClick={handleStartPhoneVerification}
                                        disabled={
                                            startingPhoneVerification ||
                                            !normalizedPhone ||
                                            (phoneVerified && normalizedPhone === phoneVerifiedForPhone)
                                        }
                                    >
                                        {startingPhoneVerification
                                            ? t('doctorCreate.phonePreparing')
                                            : phoneVerified && normalizedPhone === phoneVerifiedForPhone
                                                ? t('doctorCreate.phoneVerified')
                                                : t('doctorCreate.phoneVerify')}
                                    </button>
                                </div>

                                <div className="doctor-create-page__verify-status">
                                    <span className={phoneVerified ? 'ok' : 'pending'}>
                                        {t('doctorCreate.phoneStatus')}: {phoneVerified ? t('doctorCreate.statusVerified') : t('doctorCreate.statusNotVerified')}
                                    </span>
                                </div>
                            </div>
                        )}

                        {currentStep === 2 && (
                            <div className="doctor-create-page__panel">
                                <h2 className="doctor-create-page__panel-title">{t('doctorCreate.step3.title')}</h2>

                                <div className="doctor-create-page__grid doctor-create-page__grid--single">
                                    <label className="doctor-create-page__field">
                                        <span>{t('doctorCreate.email')}</span>
                                        <input
                                            type="email"
                                            autoComplete="off"
                                            value={form.email}
                                            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                                        />
                                    </label>
                                </div>

                                <div className="doctor-create-page__verify-row doctor-create-page__verify-row--single">
                                    <button type="button" onClick={openOrSendEmailOtp} disabled={sendingEmailCode}>
                                        {sendingEmailCode
                                            ? t('doctorCreate.emailSending')
                                            : emailVerified && normalizedEmail === emailVerifiedForEmail
                                                ? t('doctorCreate.emailVerified')
                                                : emailCodeRequested && normalizedEmail === emailCodeForEmail
                                                    ? t('doctorCreate.emailOpenOtp')
                                                    : t('doctorCreate.emailVerify')}
                                    </button>
                                </div>

                                <div className="doctor-create-page__verify-status">
                                    <span className={emailVerified ? 'ok' : 'pending'}>
                                        {t('doctorCreate.emailStatus')}: {emailVerified ? t('doctorCreate.statusVerified') : t('doctorCreate.statusNotVerified')}
                                    </span>
                                    {cooldownActive && (
                                        <span className="pending">{t('doctorCreate.retryAfter')} {formatCooldown(cooldownLeftMs)}</span>
                                    )}
                                </div>
                            </div>
                        )}

                        {currentStep === 3 && (
                            <div className="doctor-create-page__panel">
                                <h2 className="doctor-create-page__panel-title">{t('doctorCreate.step4.title')}</h2>

                                <div className="doctor-create-page__summary">
                                    <div className="doctor-create-page__summary-item">
                                        <span>{t('doctorCreate.summaryName')}</span>
                                        <strong>
                                            {form.lastName} {form.firstName}
                                            {form.middleName ? ` ${form.middleName}` : ''}
                                        </strong>
                                    </div>
                                    <div className="doctor-create-page__summary-item">
                                        <span>{t('doctorCreate.summarySpecialties')}</span>
                                        <strong>
                                            {selectedSpecialties.length
                                                ? selectedSpecialties
                                                    .map((specialtyId) => {
                                                        const specialty = availableSpecialties.find((s) => s.id === specialtyId);
                                                        return specialty ? getDoctorSpecialtyLabel(specialty, language) : specialtyId;
                                                    })
                                                    .join(', ')
                                                : t('doctorCreate.summaryEmpty')}
                                        </strong>
                                    </div>
                                    <div className="doctor-create-page__summary-item">
                                        <span>{t('doctorCreate.summaryPhone')}</span>
                                        <strong>{form.phone || t('doctorCreate.summaryEmpty')}</strong>
                                    </div>
                                    <div className="doctor-create-page__summary-item">
                                        <span>{t('doctorCreate.summaryEmail')}</span>
                                        <strong>{form.email || t('doctorCreate.summaryEmpty')}</strong>
                                    </div>
                                </div>

                                <div className="doctor-create-page__verify-status">
                                    <span className={phoneVerified ? 'ok' : 'pending'}>
                                        {t('doctorCreate.phoneStatus')}: {phoneVerified ? t('doctorCreate.statusVerified') : t('doctorCreate.statusNotVerified')}
                                    </span>
                                    <span className={emailVerified ? 'ok' : 'pending'}>
                                        {t('doctorCreate.emailStatus')}: {emailVerified ? t('doctorCreate.statusVerified') : t('doctorCreate.statusNotVerified')}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="doctor-create-page__actions">
                            {currentStep > 0 ? (
                                <button type="button" className="doctor-create-page__secondary" onClick={goPrevStep}>
                                    {t('common.back')}
                                </button>
                            ) : (
                                <span />
                            )}

                            {currentStep < STEP_ITEMS.length - 1 ? (
                                <button type="button" className="doctor-create-page__primary" onClick={goNextStep}>
                                    {t('common.next')}
                                </button>
                            ) : (
                                <button className="doctor-create-page__primary" type="submit" disabled={saving}>
                                    {saving ? t('doctorCreate.creating') : t('doctorCreate.create')}
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </section>

            {isPhoneModalOpen && telegramBotUrl && (
                <div className="doctor-create-page__modal-backdrop" onMouseDown={() => setIsPhoneModalOpen(false)}>
                    <div
                        className="doctor-create-page__modal"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="doctor-create-page__modal-title">{t('doctorCreate.phoneModalTitle')}</h2>
                        <TelegramQrCard
                            telegramBotUrl={telegramBotUrl}
                            title={t('doctorCreate.phoneModalQrTitle')}
                            subtitle={t('doctorCreate.phoneModalQrSubtitle')}
                            buttonLabel={t('doctorCreate.phoneModalOpenTelegram')}
                        />
                        <button
                            type="button"
                            className="doctor-create-page__modal-close"
                            onClick={() => setIsPhoneModalOpen(false)}
                        >
                            {t('doctorCreate.phoneModalClose')}
                        </button>
                    </div>
                </div>
            )}

            {isEmailModalOpen && (
                <div className="doctor-create-page__modal-backdrop" onMouseDown={() => setIsEmailModalOpen(false)}>
                    <div
                        className="doctor-create-page__otp-modal"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="doctor-create-page__modal-title">{t('doctorCreate.otpTitle')}</h2>
                        <p className="doctor-create-page__otp-hint">{t('doctorCreate.otpHint')}</p>

                        <div className="doctor-create-page__otp" onPaste={handleOtpPaste}>
                            {emailCodeDigits.map((digit, index) => (
                                <input
                                    key={index}
                                    ref={(el) => {
                                        otpInputRefs.current[index] = el;
                                    }}
                                    className="doctor-create-page__otp-input"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handleOtpDigitChange(index, e.target.value)}
                                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                                    aria-label={`${t('doctorCreate.otpDigit')} ${index + 1}`}
                                />
                            ))}
                        </div>

                        <div className="doctor-create-page__otp-actions">
                            <button type="button" className="doctor-create-page__secondary" onClick={() => setIsEmailModalOpen(false)}>
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                className="doctor-create-page__primary"
                                onClick={handleConfirmEmailOtp}
                                disabled={emailCode.length !== EMAIL_OTP_LENGTH}
                            >
                                {t('doctorCreate.otpConfirm')}
                            </button>
                        </div>

                        <div className="doctor-create-page__otp-footer">
                            <button
                                type="button"
                                className="doctor-create-page__otp-resend"
                                onClick={() => void handleRequestEmailCode()}
                                disabled={sendingEmailCode || cooldownActive}
                            >
                                {cooldownActive
                                    ? `${t('doctorCreate.retryAfter')} ${formatCooldown(cooldownLeftMs)}`
                                    : t('doctorCreate.otpResend')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );

    if (embedded) {
        return <div className="doctor-create-page doctor-create-page--embedded">{content}</div>;
    }

    return (
        <div className="page-shell doctor-create-page">
            <div className="container doctor-create-page__container">
                <div className="doctor-create-page__content">{content}</div>
            </div>
        </div>
    );
}



