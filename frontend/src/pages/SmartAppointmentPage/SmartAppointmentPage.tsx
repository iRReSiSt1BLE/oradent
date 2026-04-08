import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createGuestAppointment,
    createOfflineBooking,
    createPaidGooglePayTestBooking,
    createGuestSmartBooking,
    createGuestPaidGooglePayTestBooking,
    getSmartAppointmentPlan,
    type SmartAppointmentPlan,
} from '../../shared/api/appointmentApi';
import {
    buildDoctorAvatarUrl,
    getPublicDoctors,
    type PublicDoctorItem,
} from '../../shared/api/doctorApi';
import {
    getDoctorScheduleDay,
    getDoctorScheduleMonth,
    type DayScheduleResponse,
    type MonthDayCell,
} from '../../shared/api/doctorScheduleApi';
import {
    getActivePublicServices,
    type ClinicService,
} from '../../shared/api/servicesApi';
import {
    getPhoneVerificationStatus,
    startPhoneVerification,
} from '../../shared/api/phoneVerificationApi';
import { getMyProfile } from '../../shared/api/profileApi';
import { clearCart, getCart, type CartItem } from '../../shared/utils/cartStorage';
import { getToken } from '../../shared/utils/authStorage';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import { useI18n } from '../../shared/i18n/I18nProvider';
import './SmartAppointmentPage.scss';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

type PlanDoctorOption = {
    id: string;
    bookingRef: string;
    fullName: string;
    avatarUrl: string | null;
    doctor: PublicDoctorItem | null;
};

type ManualSelection = {
    serviceId: string;
    doctorId: string;
    doctorBookingRef: string;
    doctorName: string;
    avatarUrl: string | null;
    date: string;
    time: string;
};

type PaymentMethod = 'online' | 'offline';
type BookingMode = 'guest' | 'authenticated';

type ProfileInfo = {
    lastName: string;
    firstName: string;
    middleName: string | null;
    phone: string | null;
    phoneVerified: boolean;
} | null;

declare global {
    interface Window {
        google?: {
            payments?: {
                api?: {
                    PaymentsClient: new (options: {
                        environment: 'TEST' | 'PRODUCTION';
                    }) => {
                        isReadyToPay: (request: unknown) => Promise<{ result: boolean }>;
                        createButton: (options: {
                            onClick: () => void;
                            buttonType?: string;
                            buttonColor?: string;
                            buttonLocale?: string;
                            buttonSizeMode?: 'static' | 'fill';
                        }) => HTMLElement;
                        loadPaymentData: (request: unknown) => Promise<any>;
                    };
                };
            };
        };
    }
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getWeekdayLabels(language: string) {
    const locale =
        language === 'ua'
            ? 'uk-UA'
            : language === 'de'
                ? 'de-DE'
                : language === 'fr'
                    ? 'fr-FR'
                    : 'en-US';

    const monday = new Date('2026-04-06T00:00:00');
    const labels: string[] = [];

    for (let i = 0; i < 7; i += 1) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        labels.push(
            new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d),
        );
    }

    return labels;
}

type ManualCalendarCell =
    | { kind: 'empty'; key: string }
    | { kind: 'day'; key: string; day: MonthDayCell };

function buildManualCalendarCells(days: MonthDayCell[]): ManualCalendarCell[] {
    if (!days.length) return [];

    const firstDate = new Date(`${days[0].date}T00:00:00`);
    const jsDay = firstDate.getDay();
    const mondayBasedIndex = (jsDay + 6) % 7;

    const leading: ManualCalendarCell[] = Array.from({ length: mondayBasedIndex }, (_, i) => ({
        kind: 'empty',
        key: `manual-empty-start-${i}`,
    }));

    const middle: ManualCalendarCell[] = days.map((day) => ({
        kind: 'day',
        key: day.date,
        day,
    }));

    const total = leading.length + middle.length;
    const trailingCount = (7 - (total % 7)) % 7;

    const trailing: ManualCalendarCell[] = Array.from({ length: trailingCount }, (_, i) => ({
        kind: 'empty',
        key: `manual-empty-end-${i}`,
    }));

    return [...leading, ...middle, ...trailing];
}

function normalizePhone(value: string) {
    return value.trim().replace(/\s+/g, '');
}

function fullDoctorName(d: PublicDoctorItem | null): string {
    if (!d) return '';
    const value = `${d.lastName ?? ''} ${d.firstName ?? ''} ${d.middleName ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();
    return value || d.userId || d.id || '';
}

function parseDbI18nValue(raw: unknown, language: string): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, any>;

        if ('ua' in record || 'en' in record || 'de' in record || 'fr' in record) {
            return record[language] || record.ua || record.en || record.de || record.fr || '';
        }

        if ('i18n' in record && record.i18n) {
            const map = record.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }

        if ('value' in record && typeof record.value === 'string') {
            return record.value;
        }

        if ('name' in record) {
            return parseDbI18nValue(record.name, language);
        }

        if ('data' in record && record.data && typeof record.data === 'object') {
            return (
                record.data[language] ||
                record.data.ua ||
                record.data.en ||
                record.data.de ||
                record.data.fr ||
                ''
            );
        }

        return '';
    }

    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) {
            return raw;
        }

        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;

            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;

            if (data && typeof data === 'object') {
                return data[language] || data.ua || data.en || data.de || data.fr || raw;
            }

            return raw;
        } catch {
            return raw;
        }
    }

    return String(raw);
}

function formatDateTime(value: string | Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function formatDateOnly(dateIso: string) {
    const date = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateIso;

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function durationLabel(totalMinutes: number) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) return `${hours} год ${minutes} хв`;
    if (hours > 0) return `${hours} год`;
    return `${minutes} хв`;
}

function resolveDoctorByAnyId(id: string, doctors: PublicDoctorItem[]): PublicDoctorItem | null {
    if (!id) return null;
    return doctors.find((d) => d.id === id || d.userId === id) ?? null;
}

function loadGooglePayScript(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (window.google?.payments?.api?.PaymentsClient) {
            resolve();
            return;
        }

        const existing = document.querySelector<HTMLScriptElement>(
            'script[src="https://pay.google.com/gp/p/js/pay.js"]',
        );

        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener(
                'error',
                () => reject(new Error('Не вдалося завантажити Google Pay')),
                { once: true },
            );
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://pay.google.com/gp/p/js/pay.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Не вдалося завантажити Google Pay'));
        document.head.appendChild(script);
    });
}

export default function SmartAppointmentPage() {
    const token = getToken();
    const navigate = useNavigate();
    const { language } = useI18n();

    const bookingMode: BookingMode = token ? 'authenticated' : 'guest';

    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [plans, setPlans] = useState<SmartAppointmentPlan[]>([]);
    const [rejectionReason, setRejectionReason] = useState('');
    const [planning, setPlanning] = useState(false);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState<AlertState>(null);

    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [publicServices, setPublicServices] = useState<ClinicService[]>([]);
    const [profile, setProfile] = useState<ProfileInfo>(null);

    const [recommendedOpen, setRecommendedOpen] = useState(false);
    const [manualOpen, setManualOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const [manualSelections, setManualSelections] = useState<Record<string, ManualSelection>>({});

    const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
    const [doctorOptionsForService, setDoctorOptionsForService] = useState<PlanDoctorOption[]>([]);
    const [selectedDoctorId, setSelectedDoctorId] = useState('');
    const [month, setMonth] = useState(currentMonthKey());
    const [monthData, setMonthData] = useState<MonthDayCell[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dayData, setDayData] = useState<DayScheduleResponse | null>(null);
    const [selectedTime, setSelectedTime] = useState('');
    const [loadingMonth, setLoadingMonth] = useState(false);
    const [loadingDay, setLoadingDay] = useState(false);

    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('offline');
    const [paying, setPaying] = useState(false);
    const [googlePayReady, setGooglePayReady] = useState(false);

    const [guestLastName, setGuestLastName] = useState('');
    const [guestFirstName, setGuestFirstName] = useState('');
    const [guestMiddleName, setGuestMiddleName] = useState('');
    const [phoneInput, setPhoneInput] = useState('');

    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [phoneVerifiedForPhone, setPhoneVerifiedForPhone] = useState('');
    const [startingPhoneVerification, setStartingPhoneVerification] = useState(false);
    const [checkingPhoneVerification, setCheckingPhoneVerification] = useState(false);
    const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);

    const googlePayContainerRef = useRef<HTMLDivElement | null>(null);
    const googlePaymentsClientRef = useRef<any>(null);
    const autoPlansLoadedRef = useRef(false);
    const phoneVerificationPollRef = useRef<number | null>(null);

    const totalPrice = useMemo(
        () => cartItems.reduce((sum, item) => sum + Number(item.priceUah || 0), 0),
        [cartItems],
    );

    const totalDuration = useMemo(
        () => cartItems.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0),
        [cartItems],
    );

    const normalizedPhone = useMemo(() => normalizePhone(phoneInput), [phoneInput]);

    const weekdayLabels = useMemo(() => getWeekdayLabels(language), [language]);
    const manualCalendarCells = useMemo(() => buildManualCalendarCells(monthData), [monthData]);

    const paidBookingSteps = useMemo(() => {
        return cartItems
            .map((item) => {
                const selection = manualSelections[item.serviceId];
                if (!selection) return null;

                return {
                    serviceId: item.serviceId,
                    doctorId: selection.doctorId,
                    appointmentDate: `${selection.date}T${selection.time}:00`,
                };
            })
            .filter(Boolean) as Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
        }>;
    }, [cartItems, manualSelections]);

    const guestBookingSteps = useMemo(() => {
        return cartItems
            .map((item) => {
                const selection = manualSelections[item.serviceId];
                if (!selection) return null;

                return {
                    serviceId: item.serviceId,
                    doctorId: selection.doctorBookingRef,
                    appointmentDate: `${selection.date}T${selection.time}:00`,
                };
            })
            .filter(Boolean) as Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
        }>;
    }, [cartItems, manualSelections]);

    const needsPhoneVerification = useMemo(() => {
        if (bookingMode === 'guest') return true;
        return !profile?.phone || !profile?.phoneVerified;
    }, [bookingMode, profile]);

    const allServicesSelected = useMemo(() => {
        if (!cartItems.length) return false;
        return cartItems.every((item) => Boolean(manualSelections[item.serviceId]));
    }, [cartItems, manualSelections]);

    const guestDetailsReady = useMemo(() => {
        if (bookingMode !== 'guest') return true;
        return Boolean(
            guestLastName.trim() &&
            guestFirstName.trim() &&
            normalizedPhone &&
            phoneVerified &&
            phoneVerifiedForPhone === normalizedPhone,
        );
    }, [
        bookingMode,
        guestLastName,
        guestFirstName,
        normalizedPhone,
        phoneVerified,
        phoneVerifiedForPhone,
    ]);

    const authPhoneReady = useMemo(() => {
        if (bookingMode !== 'authenticated') return true;
        if (!needsPhoneVerification) return true;
        return Boolean(
            normalizedPhone &&
            phoneVerified &&
            phoneVerifiedForPhone === normalizedPhone,
        );
    }, [bookingMode, needsPhoneVerification, normalizedPhone, phoneVerified, phoneVerifiedForPhone]);

    const buildPlans = useCallback(async () => {
        const items = getCart();
        if (!items.length) {
            setPlans([]);
            setRejectionReason('');
            return;
        }

        try {
            setPlanning(true);

            const response = await getSmartAppointmentPlan(token ?? null, {
                serviceIds: items.map((item) => item.serviceId),
                mode: 'same-doctor-first',
            });

            const nextPlans = Array.isArray(response.plans) ? response.plans : [];
            setPlans(nextPlans);
            setRejectionReason((response as any).rejectionReason || '');

            if (!nextPlans.length && (response as any).rejectionReason) {
                setAlert({
                    variant: 'info',
                    message: (response as any).rejectionReason,
                });
            }
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || 'Не вдалося побудувати варіанти запису',
            });
        } finally {
            setPlanning(false);
        }
    }, [token]);

    useEffect(() => {
        async function init() {
            try {
                setLoading(true);

                const items = getCart();
                setCartItems(items);

                const [doctorsRes, servicesRes] = await Promise.all([
                    getPublicDoctors(),
                    getActivePublicServices(),
                ]);

                const doctorsList = Array.isArray((doctorsRes as any)?.doctors)
                    ? (doctorsRes as any).doctors
                    : [];

                const servicesList = Array.isArray((servicesRes as any)?.services)
                    ? (servicesRes as any).services
                    : [];

                setDoctors(doctorsList);
                setPublicServices(servicesList);

                if (token) {
                    try {
                        const profileRes = await getMyProfile(token);
                        const p = profileRes.profile;
                        setProfile({
                            lastName: p.lastName,
                            firstName: p.firstName,
                            middleName: p.middleName,
                            phone: p.phone,
                            phoneVerified: p.phoneVerified,
                        });

                        if (p.phone) {
                            setPhoneInput(p.phone);
                            if (p.phoneVerified) {
                                setPhoneVerified(true);
                                setPhoneVerifiedForPhone(p.phone);
                            }
                        }
                    } catch {
                        setProfile(null);
                    }
                }
            } catch {
                setAlert({
                    variant: 'error',
                    message: 'Не вдалося завантажити сторінку розумного запису',
                });
            } finally {
                setLoading(false);
            }
        }

        void init();
    }, [token]);

    useEffect(() => {
        if (loading) return;
        if (!token) return;
        if (!cartItems.length) return;
        if (autoPlansLoadedRef.current) return;

        autoPlansLoadedRef.current = true;
        void buildPlans();
    }, [loading, token, cartItems.length, buildPlans]);

    useEffect(() => {
        if (!confirmOpen || paymentMethod !== 'online') return;

        let cancelled = false;

        async function setupGooglePay() {
            try {
                await loadGooglePayScript();

                if (cancelled) return;

                const paymentsClient = new window.google!.payments!.api!.PaymentsClient({
                    environment: 'TEST',
                });

                googlePaymentsClientRef.current = paymentsClient;

                const readyToPayRequest = {
                    apiVersion: 2,
                    apiVersionMinor: 0,
                    allowedPaymentMethods: [
                        {
                            type: 'CARD',
                            parameters: {
                                allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
                                allowedCardNetworks: ['MASTERCARD', 'VISA'],
                                billingAddressRequired: false,
                            },
                        },
                    ],
                };

                const ready = await paymentsClient.isReadyToPay(readyToPayRequest);

                if (cancelled) return;

                setGooglePayReady(Boolean(ready?.result));

                if (!ready?.result || !googlePayContainerRef.current) return;

                googlePayContainerRef.current.innerHTML = '';

                const button = paymentsClient.createButton({
                    onClick: onGooglePayButtonClick,
                    buttonType: 'pay',
                    buttonColor: 'default',
                    buttonLocale: 'uk',
                    buttonSizeMode: 'fill',
                });

                googlePayContainerRef.current.appendChild(button);
            } catch (err: any) {
                setGooglePayReady(false);
                setAlert({
                    variant: 'error',
                    message: err?.message || 'Не вдалося ініціалізувати Google Pay',
                });
            }
        }

        void setupGooglePay();

        return () => {
            cancelled = true;
        };
    }, [confirmOpen, paymentMethod, totalPrice]);

    useEffect(() => {
        if (!phoneVerificationSessionId || phoneVerified) return;

        if (phoneVerificationPollRef.current) {
            window.clearInterval(phoneVerificationPollRef.current);
        }

        phoneVerificationPollRef.current = window.setInterval(() => {
            void handleCheckPhoneVerification(true);
        }, 4000);

        return () => {
            if (phoneVerificationPollRef.current) {
                window.clearInterval(phoneVerificationPollRef.current);
                phoneVerificationPollRef.current = null;
            }
        };
    }, [phoneVerificationSessionId, phoneVerified]);

    function getServiceFromPublic(serviceId: string) {
        return publicServices.find((s) => s.id === serviceId) || null;
    }

    function getDoctorsFromPublicService(serviceId: string): PlanDoctorOption[] {
        const service = getServiceFromPublic(serviceId);
        if (!service) return [];

        const fromDoctorIds = Array.isArray((service as any).doctorIds)
            ? ((service as any).doctorIds as string[])
            : [];

        const fromDoctors = Array.isArray((service as any).doctors)
            ? ((service as any).doctors as Array<{ id?: string; userId?: string }>)
                .map((d) => d.userId || d.id || '')
                .filter(Boolean)
            : [];

        const refs = [...new Set([...fromDoctorIds, ...fromDoctors])];

        const eligibleDoctors = doctors.filter((doctor) =>
            refs.includes(doctor.userId || doctor.id),
        );

        return eligibleDoctors.map((doctor) => ({
            id: doctor.id,
            bookingRef: doctor.userId || doctor.id,
            fullName: fullDoctorName(doctor),
            avatarUrl: doctor.hasAvatar
                ? buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion)
                : null,
            doctor,
        }));
    }

    function getDoctorsForService(serviceId: string): PlanDoctorOption[] {
        const map = new Map<string, PlanDoctorOption>();

        for (const plan of plans) {
            for (const step of plan.steps || []) {
                if (step.serviceId !== serviceId) continue;

                const refId = step.doctorId || '';
                const doctor = resolveDoctorByAnyId(refId, doctors);

                const realDoctorId = doctor?.id || refId;
                const bookingRef = doctor?.userId || refId;
                if (!realDoctorId || map.has(realDoctorId)) continue;

                const fullName =
                    doctor ? fullDoctorName(doctor) : (step as any).doctorName || refId;

                const avatarUrl =
                    doctor && doctor.hasAvatar
                        ? buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion)
                        : null;

                map.set(realDoctorId, {
                    id: realDoctorId,
                    bookingRef,
                    fullName,
                    avatarUrl,
                    doctor,
                });
            }
        }

        const smartDoctors = [...map.values()];
        if (smartDoctors.length) return smartDoctors;

        return getDoctorsFromPublicService(serviceId);
    }

    async function openManualPicker(serviceId: string) {
        if (token && !plans.length) {
            await buildPlans();
        }

        const options = getDoctorsForService(serviceId);

        setEditingServiceId(serviceId);
        setDoctorOptionsForService(options);
        setSelectedDoctorId('');
        setSelectedDate(null);
        setSelectedTime('');
        setDayData(null);
        setMonth(currentMonthKey());
        setMonthData([]);
        setManualOpen(true);

        if (!options.length) {
            setAlert({
                variant: 'info',
                message: 'Для цієї послуги поки не знайдено доступних лікарів',
            });
        }
    }

    useEffect(() => {
        async function loadMonth() {
            if (!manualOpen || !selectedDoctorId) {
                setMonthData([]);
                return;
            }

            try {
                setLoadingMonth(true);
                const response = await getDoctorScheduleMonth(selectedDoctorId, month);
                setMonthData(Array.isArray(response.days) ? response.days : []);
            } catch (err: any) {
                setAlert({
                    variant: 'error',
                    message: err?.message || 'Не вдалося завантажити календар лікаря',
                });
            } finally {
                setLoadingMonth(false);
            }
        }

        void loadMonth();
    }, [manualOpen, selectedDoctorId, month]);

    useEffect(() => {
        async function loadDay() {
            if (!manualOpen || !selectedDoctorId || !selectedDate) {
                setDayData(null);
                return;
            }

            try {
                setLoadingDay(true);
                const response = await getDoctorScheduleDay(selectedDoctorId, selectedDate);
                setDayData(response);
            } catch (err: any) {
                setAlert({
                    variant: 'error',
                    message: err?.message || 'Не вдалося завантажити вільний час',
                });
            } finally {
                setLoadingDay(false);
            }
        }

        void loadDay();
    }, [manualOpen, selectedDoctorId, selectedDate]);

    function applyManualSelection() {
        if (!editingServiceId || !selectedDoctorId || !selectedDate || !selectedTime) {
            setAlert({
                variant: 'info',
                message: 'Оберіть лікаря, дату і час',
            });
            return;
        }

        const option = doctorOptionsForService.find((d) => d.id === selectedDoctorId) ?? null;

        setManualSelections((prev) => ({
            ...prev,
            [editingServiceId]: {
                serviceId: editingServiceId,
                doctorId: option?.doctor?.id || selectedDoctorId,
                doctorBookingRef: option?.bookingRef || selectedDoctorId,
                doctorName: option?.fullName || selectedDoctorId,
                avatarUrl: option?.avatarUrl || null,
                date: selectedDate,
                time: selectedTime,
            },
        }));

        setManualOpen(false);
        setEditingServiceId(null);
        setDoctorOptionsForService([]);
        setSelectedDoctorId('');
        setSelectedDate(null);
        setSelectedTime('');
        setDayData(null);
    }

    function applyRecommendedPlan(plan: SmartAppointmentPlan) {
        const nextSelections: Record<string, ManualSelection> = {};

        for (const step of plan.steps) {
            const doctor = resolveDoctorByAnyId(step.doctorId, doctors);
            const doctorName =
                (step as any).doctorName || (doctor ? fullDoctorName(doctor) : step.doctorId);

            const avatarUrl =
                doctor && doctor.hasAvatar
                    ? buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion)
                    : null;

            const start = new Date(step.startAt);
            const yyyy = start.getFullYear();
            const mm = String(start.getMonth() + 1).padStart(2, '0');
            const dd = String(start.getDate()).padStart(2, '0');
            const hh = String(start.getHours()).padStart(2, '0');
            const min = String(start.getMinutes()).padStart(2, '0');

            nextSelections[step.serviceId] = {
                serviceId: step.serviceId,
                doctorId: doctor?.id || step.doctorId,
                doctorBookingRef: doctor?.userId || step.doctorId,
                doctorName,
                avatarUrl,
                date: `${yyyy}-${mm}-${dd}`,
                time: `${hh}:${min}`,
            };
        }

        setManualSelections((prev) => ({ ...prev, ...nextSelections }));
        setRecommendedOpen(false);
        setConfirmOpen(true);
    }

    function resetAfterSuccess() {
        clearCart();
        setCartItems([]);
        setPlans([]);
        setManualSelections({});
        setDoctorOptionsForService([]);
        setEditingServiceId(null);
        setSelectedDoctorId('');
        setSelectedDate(null);
        setSelectedTime('');
        setDayData(null);
        setMonthData([]);
        setRecommendedOpen(false);
        setManualOpen(false);
        setConfirmOpen(false);
        setPhoneVerificationSessionId('');
        setTelegramBotUrl('');
        setPhoneVerified(false);
        setPhoneVerifiedForPhone('');
        setIsPhoneModalOpen(false);
        autoPlansLoadedRef.current = false;
    }

    function handleClearCart() {
        resetAfterSuccess();
        setAlert({
            variant: 'success',
            message: 'Кошик очищено',
        });
    }

    async function handleStartPhoneVerification() {
        try {
            const phone = normalizePhone(phoneInput);

            if (!phone) {
                throw new Error('Введіть номер телефону');
            }

            setStartingPhoneVerification(true);

            const result = await startPhoneVerification(phone);

            setPhoneVerificationSessionId((result as any).sessionId || '');
            setTelegramBotUrl((result as any).telegramBotUrl || '');
            setPhoneVerified(false);
            setPhoneVerifiedForPhone('');
            setIsPhoneModalOpen(true);

            setAlert({
                variant: 'info',
                message: 'Підтвердьте номер через Telegram',
            });
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || 'Не вдалося розпочати підтвердження телефону',
            });
        } finally {
            setStartingPhoneVerification(false);
        }
    }

    async function handleCheckPhoneVerification(silent = false) {
        try {
            if (!phoneVerificationSessionId) return;

            setCheckingPhoneVerification(true);

            const result = await getPhoneVerificationStatus(phoneVerificationSessionId as any);

            const verified =
                Boolean((result as any)?.verified) ||
                (result as any)?.status === 'VERIFIED' ||
                (result as any)?.status === 'verified';

            if (verified) {
                setPhoneVerified(true);
                setPhoneVerifiedForPhone(normalizedPhone);
                setIsPhoneModalOpen(false);

                if (!silent) {
                    setAlert({
                        variant: 'success',
                        message: 'Телефон підтверджено',
                    });
                }
            }
        } catch (err: any) {
            if (!silent) {
                setAlert({
                    variant: 'error',
                    message: err?.message || 'Не вдалося перевірити статус телефону',
                });
            }
        } finally {
            setCheckingPhoneVerification(false);
        }
    }

    async function createGuestOfflineBookings() {
        if (!guestDetailsReady) {
            throw new Error('Заповніть ПІБ і підтвердьте телефон');
        }

        if (!guestBookingSteps.length) {
            throw new Error('Немає даних для створення запису');
        }

        if (typeof createGuestSmartBooking === 'function') {
            await createGuestSmartBooking({
                lastName: guestLastName.trim(),
                firstName: guestFirstName.trim(),
                middleName: guestMiddleName.trim() || undefined,
                phone: normalizedPhone,
                phoneVerificationSessionId,
                steps: guestBookingSteps,
                paymentMethod: 'CASH',
            });
            return;
        }

        for (const step of guestBookingSteps) {
            await createGuestAppointment({
                lastName: guestLastName.trim(),
                firstName: guestFirstName.trim(),
                middleName: guestMiddleName.trim() || undefined,
                phone: normalizedPhone,
                phoneVerificationSessionId,
                doctorId: step.doctorId,
                serviceId: step.serviceId,
                appointmentDate: new Date(step.appointmentDate).toISOString(),
            });
        }
    }

    async function createAuthenticatedOfflineBooking() {
        if (!token) {
            throw new Error('Потрібна авторизація');
        }

        if (!paidBookingSteps.length) {
            throw new Error('Немає даних для створення запису');
        }

        await createOfflineBooking(token, {
            steps: paidBookingSteps,
            paymentMethod: 'CASH',
            phoneVerificationSessionId: needsPhoneVerification ? phoneVerificationSessionId : undefined,
        });
    }

    async function confirmGooglePayTest(paymentData: any) {
        if (!token) {
            throw new Error('Потрібна авторизація');
        }

        if (!paidBookingSteps.length) {
            throw new Error('Немає даних для створення запису');
        }

        return createPaidGooglePayTestBooking(token, {
            steps: paidBookingSteps,
            googleTransactionId:
                paymentData?.paymentMethodData?.info?.cardNetwork ||
                `gpay-test-${Date.now()}`,
            googlePaymentToken: JSON.stringify(
                paymentData?.paymentMethodData?.tokenizationData || {},
            ),
            paymentMethod: 'GOOGLE_PAY',
            phoneVerificationSessionId: needsPhoneVerification ? phoneVerificationSessionId : undefined,
        });
    }

    async function confirmGuestGooglePayTest(paymentData: any) {
        if (!guestDetailsReady) {
            throw new Error('Заповніть ПІБ і підтвердьте телефон');
        }

        if (!guestBookingSteps.length) {
            throw new Error('Немає даних для створення запису');
        }

        if (typeof createGuestPaidGooglePayTestBooking !== 'function') {
            throw new Error('Гостьова онлайн-оплата ще не підключена на бекенді');
        }

        return createGuestPaidGooglePayTestBooking({
            lastName: guestLastName.trim(),
            firstName: guestFirstName.trim(),
            middleName: guestMiddleName.trim() || undefined,
            phone: normalizedPhone,
            phoneVerificationSessionId,
            steps: guestBookingSteps,
            googleTransactionId:
                paymentData?.paymentMethodData?.info?.cardNetwork ||
                `gpay-test-${Date.now()}`,
            googlePaymentToken: JSON.stringify(
                paymentData?.paymentMethodData?.tokenizationData || {},
            ),
            paymentMethod: 'GOOGLE_PAY',
        });
    }

    async function onGooglePayButtonClick() {
        try {
            if (!googlePaymentsClientRef.current) {
                throw new Error('Google Pay ще не ініціалізований');
            }

            if (!allServicesSelected) {
                throw new Error('Спочатку оберіть усі послуги, лікарів і час');
            }

            if (bookingMode === 'authenticated' && !authPhoneReady) {
                throw new Error('Підтвердьте телефон перед оплатою');
            }

            if (bookingMode === 'guest' && !guestDetailsReady) {
                throw new Error('Заповніть ПІБ і підтвердьте телефон');
            }

            setPaying(true);

            const paymentDataRequest = {
                apiVersion: 2,
                apiVersionMinor: 0,
                allowedPaymentMethods: [
                    {
                        type: 'CARD',
                        parameters: {
                            allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
                            allowedCardNetworks: ['MASTERCARD', 'VISA'],
                            billingAddressRequired: false,
                        },
                        tokenizationSpecification: {
                            type: 'PAYMENT_GATEWAY',
                            parameters: {
                                gateway: 'example',
                                gatewayMerchantId: 'exampleGatewayMerchantId',
                            },
                        },
                    },
                ],
                merchantInfo: {
                    merchantName: 'ORADENT TEST',
                },
                transactionInfo: {
                    totalPriceStatus: 'FINAL',
                    totalPrice: totalPrice.toFixed(2),
                    currencyCode: 'UAH',
                    countryCode: 'UA',
                },
            };

            const paymentData = await googlePaymentsClientRef.current.loadPaymentData(paymentDataRequest);

            if (bookingMode === 'guest') {
                await confirmGuestGooglePayTest(paymentData);
            } else {
                await confirmGooglePayTest(paymentData);
            }

            setAlert({
                variant: 'success',
                message: 'Оплату підтверджено, запис створено',
            });

            resetAfterSuccess();
            navigate('/');
        } catch (err: any) {
            if (String(err?.statusCode || '') === 'CANCELED') {
                return;
            }

            setAlert({
                variant: 'error',
                message: err?.message || 'Помилка Google Pay',
            });
        } finally {
            setPaying(false);
        }
    }

    async function handleOfflineConfirm() {
        try {
            if (!allServicesSelected) {
                throw new Error('Спочатку оберіть лікарів і час');
            }

            if (bookingMode === 'guest') {
                await createGuestOfflineBookings();
            } else {
                if (!authPhoneReady) {
                    throw new Error('Підтвердьте телефон перед записом');
                }
                await createAuthenticatedOfflineBooking();
            }

            setAlert({
                variant: 'success',
                message: 'Запис успішно створено',
            });

            resetAfterSuccess();
            navigate('/');
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || 'Не вдалося створити запис',
            });
        }
    }

    if (loading) {
        return <div className="smart-appointment-page__loading">Завантаження...</div>;
    }

    return (
        <section className="smart-appointment-page">
            {alert && (
                <AlertToast
                    variant={alert.variant}
                    message={alert.message}
                    onClose={() => setAlert(null)}
                />
            )}

            <div className="smart-appointment-page__container container">


                <div className="smart-appointment-page__main">
                    <div className="smart-appointment-page__panel">
                        <h2>ОБРАНІ ПОСЛУГИ</h2>

                        {!cartItems.length ? (
                            <div className="smart-appointment-page__empty">Кошик порожній.</div>
                        ) : (
                            <>
                                <div className="smart-appointment-page__cart-list">
                                    {cartItems.map((item) => {
                                        const selected = manualSelections[item.serviceId];

                                        return (
                                            <div
                                                key={item.serviceId}
                                                className="smart-appointment-page__cart-item"
                                            >
                                                <div className="smart-appointment-page__cart-main">
                                                    <strong>
                                                        {parseDbI18nValue(item.name, language)}
                                                    </strong>

                                                    <div className="smart-appointment-page__cart-meta">
                                                        <span>{item.priceUah} грн</span>
                                                        <span>{item.durationMinutes} хв</span>
                                                    </div>
                                                </div>

                                                {selected ? (
                                                    <div className="smart-appointment-page__picked">
                                                        <div className="smart-appointment-page__picked-doctor">
                                                            {selected.avatarUrl ? (
                                                                <img
                                                                    className="smart-appointment-page__avatar"
                                                                    src={selected.avatarUrl}
                                                                    alt={selected.doctorName}
                                                                />
                                                            ) : (
                                                                <div className="smart-appointment-page__avatar smart-appointment-page__avatar--placeholder">
                                                                    {(selected.doctorName?.[0] || 'Л').toUpperCase()}
                                                                </div>
                                                            )}

                                                            <div>
                                                                <span className="smart-appointment-page__picked-name">
                                                                    {selected.doctorName}
                                                                </span>

                                                                <span className="smart-appointment-page__picked-time">
                                                                    {formatDateOnly(selected.date)} · {selected.time}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                    <button
                                                        type="button"
                                                        className="smart-appointment-page__secondary"
                                                        onClick={() => void openManualPicker(item.serviceId)}
                                                    >
                                                        {selected ? 'Змінити вручну' : 'Обрати вручну'}
                                                    </button>

                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="smart-appointment-page__summary">
                                    <p>
                                        <span>Кількість:</span>
                                        <strong>{cartItems.length}</strong>
                                    </p>
                                    <p>
                                        <span>Тривалість:</span>
                                        <strong>{durationLabel(totalDuration)}</strong>
                                    </p>
                                    <p>
                                        <span>Разом:</span>
                                        <strong>{totalPrice} грн</strong>
                                    </p>
                                </div>

                                <div className="smart-appointment-page__entry-actions">
                                    <button
                                        type="button"
                                        className="smart-appointment-page__primary"
                                        onClick={() => {
                                            void buildPlans();
                                            setRecommendedOpen(true);
                                        }}
                                        disabled={!cartItems.length}
                                    >
                                        Переглянути рекомендовані варіанти
                                    </button>

                                    <button
                                        type="button"
                                        className="smart-appointment-page__secondary"
                                        onClick={() => {
                                            if (cartItems[0]) {
                                                void openManualPicker(cartItems[0].serviceId);
                                            }
                                        }}
                                        disabled={!cartItems.length}
                                    >
                                        Вибрати самостійно
                                    </button>

                                    <button
                                        type="button"
                                        className="smart-appointment-page__secondary"
                                        onClick={handleClearCart}
                                        disabled={!cartItems.length}
                                    >
                                        Очистити кошик
                                    </button>
                                </div>

                                {allServicesSelected ? (
                                    <div className="smart-appointment-page__confirm-row">
                                        <button
                                            type="button"
                                            className="smart-appointment-page__primary"
                                            onClick={() => setConfirmOpen(true)}
                                        >
                                            Підтвердити запис
                                        </button>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {recommendedOpen ? (
                <div
                    className="smart-appointment-page__modal-backdrop"
                    onClick={() => setRecommendedOpen(false)}
                >
                    <div
                        className="smart-appointment-page__modal smart-appointment-page__modal--wide"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="smart-appointment-page__modal-header">
                            <div>
                                <h3>РЕКОМЕНДОВАНІ ВАРІАНТИ</h3>
                            </div>

                            <button
                                type="button"
                                className="smart-appointment-page__modal-close"
                                onClick={() => setRecommendedOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="smart-appointment-page__modal-body">
                            {!plans.length ? (
                                <div className="smart-appointment-page__empty">
                                    {planning
                                        ? 'Оновлення варіантів...'
                                        : rejectionReason || 'Поки що немає побудованих варіантів.'}
                                </div>
                            ) : (
                                <div className="smart-appointment-page__plans">
                                    {plans.map((plan, index) => (
                                        <article
                                            key={`${plan.strategy}-${index}`}
                                            className="smart-appointment-page__plan"
                                        >
                                            <div className="smart-appointment-page__plan-head">
                                                <div>
                                                    <h3>
                                                        {plan.sameDoctor ? 'Один лікар' : 'Кілька лікарів'}
                                                    </h3>
                                                    <p>
                                                        {plan.sameDoctor
                                                            ? 'Усі послуги покриває один лікар'
                                                            : 'Маршрут із кількох лікарів'}
                                                    </p>
                                                </div>

                                                <div className="smart-appointment-page__plan-meta">
                                                    <span>{durationLabel(plan.totalDurationMinutes)}</span>
                                                    <span>{plan.doctorIds.length} лік.</span>
                                                </div>
                                            </div>

                                            <div className="smart-appointment-page__plan-window">
                                                <strong>Початок:</strong> {formatDateTime(plan.startAt)}
                                                <br />
                                                <strong>Кінець:</strong> {formatDateTime(plan.endAt)}
                                            </div>

                                            <div className="smart-appointment-page__steps">
                                                {plan.steps.map((step, stepIndex) => {
                                                    const doctor = resolveDoctorByAnyId(step.doctorId, doctors);
                                                    const avatarUrl =
                                                        doctor && doctor.hasAvatar
                                                            ? buildDoctorAvatarUrl(
                                                                doctor.id,
                                                                'sm',
                                                                doctor.avatarVersion,
                                                            )
                                                            : null;

                                                    const doctorName =
                                                        (step as any).doctorName ||
                                                        (doctor ? fullDoctorName(doctor) : step.doctorId);

                                                    return (
                                                        <div
                                                            key={`${step.serviceId}-${stepIndex}`}
                                                            className="smart-appointment-page__step"
                                                        >
                                                            <div className="smart-appointment-page__step-index">
                                                                {stepIndex + 1}
                                                            </div>

                                                            <div className="smart-appointment-page__step-body">
                                                                <div className="smart-appointment-page__step-top">
                                                                    <strong>
                                                                        {parseDbI18nValue(step.serviceName, language)}
                                                                    </strong>

                                                                    <span className="smart-appointment-page__step-duration">
                                                                        {step.durationMinutes} хв
                                                                    </span>
                                                                </div>

                                                                <div className="smart-appointment-page__step-doctor-row">
                                                                    {avatarUrl ? (
                                                                        <img
                                                                            className="smart-appointment-page__avatar"
                                                                            src={avatarUrl}
                                                                            alt={doctorName}
                                                                        />
                                                                    ) : (
                                                                        <div className="smart-appointment-page__avatar smart-appointment-page__avatar--placeholder">
                                                                            {(doctorName?.[0] || 'Л').toUpperCase()}
                                                                        </div>
                                                                    )}

                                                                    <div className="smart-appointment-page__step-doctor-meta">
                                                                        <span className="smart-appointment-page__step-doctor-name">
                                                                            {doctorName}
                                                                        </span>

                                                                        <span className="smart-appointment-page__step-time">
                                                                            {formatDateTime(step.startAt)} —{' '}
                                                                            {formatDateTime(step.endAt)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="smart-appointment-page__recommended-actions">
                                                <button
                                                    type="button"
                                                    className="smart-appointment-page__primary"
                                                    onClick={() => applyRecommendedPlan(plan)}
                                                >
                                                    Записатися
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {manualOpen ? (
                <div
                    className="smart-appointment-page__modal-backdrop"
                    onClick={() => setManualOpen(false)}
                >
                    <div
                        className="smart-appointment-page__modal smart-appointment-page__modal--wide"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="smart-appointment-page__modal-header">
                            <div>
                                <h3>РУЧНИЙ ВИБІР</h3>
                                <p>
                                    {editingServiceId
                                        ? `Послуга: ${
                                            parseDbI18nValue(
                                                cartItems.find((x) => x.serviceId === editingServiceId)?.name,
                                                language,
                                            ) || ''
                                        }`
                                        : 'Оберіть лікаря, день і час'}
                                </p>
                            </div>

                            <button
                                type="button"
                                className="smart-appointment-page__modal-close"
                                onClick={() => setManualOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="smart-appointment-page__modal-body">
                            <div className="smart-appointment-page__doctor-strip">
                                {doctorOptionsForService.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`smart-appointment-page__doctor-chip ${
                                            option.id === selectedDoctorId ? 'is-active' : ''
                                        }`}
                                        onClick={() => {
                                            setSelectedDoctorId(option.id);
                                            setSelectedDate(null);
                                            setSelectedTime('');
                                            setDayData(null);
                                        }}
                                    >
                                        {option.avatarUrl ? (
                                            <img
                                                className="smart-appointment-page__avatar"
                                                src={option.avatarUrl}
                                                alt={option.fullName}
                                            />
                                        ) : (
                                            <div className="smart-appointment-page__avatar smart-appointment-page__avatar--placeholder">
                                                {(option.fullName?.[0] || 'Л').toUpperCase()}
                                            </div>
                                        )}

                                        <span>{option.fullName}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="smart-appointment-page__schedule-layout">
                                <div className="smart-appointment-page__calendar-box">
                                    <div className="smart-appointment-page__calendar-head">
                                        <h3>Календар</h3>

                                        <input
                                            type="month"
                                            value={month}
                                            onChange={(e) => setMonth(e.target.value)}
                                        />
                                    </div>

                                    <div className="smart-appointment-page__calendar-scroll">
                                        <div className="smart-appointment-page__weekday-row">
                                            {weekdayLabels.map((label) => (
                                                <div key={label} className="smart-appointment-page__weekday-cell">
                                                    {label}
                                                </div>
                                            ))}
                                        </div>

                                        {loadingMonth ? (
                                            <div className="smart-appointment-page__state">
                                                Оновлення календаря...
                                            </div>
                                        ) : (
                                            <div className="smart-appointment-page__month-grid">
                                                {manualCalendarCells.map((cell) =>
                                                        cell.kind === 'empty' ? (
                                                            <div
                                                                key={cell.key}
                                                                className="smart-appointment-page__day smart-appointment-page__day--empty"
                                                            />
                                                        ) : (
                                                            <button
                                                                key={cell.key}
                                                                type="button"
                                                                className={[
                                                                    'smart-appointment-page__day',
                                                                    cell.day.date === selectedDate ? 'is-selected' : '',
                                                                    !cell.day.isWorking
                                                                        ? 'is-off'
                                                                        : cell.day.freeSlots > 0
                                                                            ? 'is-free'
                                                                            : 'is-busy',
                                                                ].join(' ')}
                                                                onClick={() => {
                                                                    setSelectedDate(cell.day.date);
                                                                    setSelectedTime('');
                                                                    setDayData(null);
                                                                }}
                                                            >
                            <span className="smart-appointment-page__day-number">
                                {cell.day.date.slice(-2)}
                            </span>

                                                                <small className="smart-appointment-page__day-meta">
                                                                    {cell.day.freeSlots}/{cell.day.totalSlots}
                                                                </small>
                                                            </button>
                                                        ),
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="smart-appointment-page__slots-box">

                                        <h3 className={"smart-slot-pick"}>
                                            {selectedDate
                                                ? `Вільний час на ${formatDateOnly(selectedDate)}`
                                                : 'Оберіть день'}
                                        </h3>

                                    {!selectedDate ? (
                                        <div className="smart-appointment-page__state">
                                            Оберіть дату в календарі.
                                        </div>
                                    ) : loadingDay ? (
                                        <div className="smart-appointment-page__state">
                                            Завантаження часу...
                                        </div>
                                    ) : !dayData?.isWorking ? (
                                        <div className="smart-appointment-page__state">
                                            У цей день лікар не працює або день заблоковано.
                                        </div>
                                    ) : (
                                        <div className="smart-appointment-page__slots">
                                            {dayData.slots
                                                .filter((s) => s.state === 'FREE')
                                                .map((slot) => (
                                                    <button
                                                        key={slot.time}
                                                        type="button"
                                                        className={`smart-appointment-page__slot ${
                                                            selectedTime === slot.time ? 'is-selected' : ''
                                                        }`}
                                                        onClick={() => setSelectedTime(slot.time)}
                                                    >
                                                        <span>{slot.time}</span>

                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="smart-appointment-page__modal-actions">
                                <button
                                    type="button"
                                    className="smart-appointment-page__secondary"
                                    onClick={() => setManualOpen(false)}
                                >
                                    Скасувати
                                </button>

                                <button
                                    type="button"
                                    className="smart-appointment-page__primary"
                                    onClick={applyManualSelection}
                                >
                                    Обрати
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {confirmOpen ? (
                <div
                    className="smart-appointment-page__modal-backdrop"
                    onClick={() => setConfirmOpen(false)}
                >
                    <div
                        className="smart-appointment-page__modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="smart-appointment-page__modal-header">
                            <div>
                                <h3>ПІДТВЕРДЖЕННЯ ЗАПИСУ</h3>
                                <p>Перевір інформацію перед фінальним підтвердженням.</p>
                            </div>

                            <button
                                type="button"
                                className="smart-appointment-page__modal-close"
                                onClick={() => setConfirmOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="smart-appointment-page__modal-body">
                            <div className="smart-appointment-page__confirm-list">
                                {cartItems.map((item) => {
                                    const selection = manualSelections[item.serviceId];

                                    return (
                                        <div
                                            key={item.serviceId}
                                            className="smart-appointment-page__confirm-item"
                                        >
                                            <strong>{parseDbI18nValue(item.name, language)}</strong>

                                            {selection ? (
                                                <>
                                                    <span>Лікар: {selection.doctorName}</span>
                                                    <span>
                                                        Дата: {formatDateOnly(selection.date)} · {selection.time}
                                                    </span>
                                                </>
                                            ) : (
                                                <span>Ще не обрано</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {bookingMode === 'guest' ? (
                                <div className="smart-appointment-page__identity-card">
                                    <div className="smart-appointment-page__identity-head">
                                        <h4>Дані для запису</h4>
                                        <p>Для гостьового запису потрібно вказати ПІБ і підтвердити номер телефону.</p>
                                    </div>

                                    <div className="smart-appointment-page__identity-grid">
                                        <label className="smart-appointment-page__field">
                                            <span>ПРІЗВИЩЕ</span>
                                            <input
                                                className="smart-appointment-page__input"
                                                value={guestLastName}
                                                onChange={(e) => setGuestLastName(e.target.value)}
                                                placeholder="Введіть прізвище"
                                            />
                                        </label>

                                        <label className="smart-appointment-page__field">
                                            <span>ІМ'Я</span>
                                            <input
                                                className="smart-appointment-page__input"
                                                value={guestFirstName}
                                                onChange={(e) => setGuestFirstName(e.target.value)}
                                                placeholder="Введіть ім'я"
                                            />
                                        </label>

                                        <label className="smart-appointment-page__field smart-appointment-page__field--wide">
                                            <span>ПО БАТЬКОВІ</span>
                                            <input
                                                className="smart-appointment-page__input"
                                                value={guestMiddleName}
                                                onChange={(e) => setGuestMiddleName(e.target.value)}
                                                placeholder="Введіть по батькові"
                                            />
                                        </label>

                                        <label className="smart-appointment-page__field smart-appointment-page__field--wide">
                                            <span>ТЕЛЕФОН</span>
                                            <input
                                                className="smart-appointment-page__input"
                                                value={phoneInput}
                                                onChange={(e) => {
                                                    setPhoneInput(e.target.value);
                                                    setPhoneVerified(false);
                                                    setPhoneVerifiedForPhone('');
                                                }}
                                                placeholder="+380..."
                                            />
                                        </label>
                                    </div>

                                    {phoneVerified && normalizedPhone === phoneVerifiedForPhone ? (
                                        <div className="smart-appointment-page__verified-box">
                                            Телефон підтверджено
                                        </div>
                                    ) : (
                                        <div className="smart-appointment-page__verify-card">
                                            <div className="smart-appointment-page__verify-card-top">
                                                <div className="smart-appointment-page__verify-copy">
                                                    <strong>Підтвердження телефону</strong>
                                                    <span>Підтвердіть номер через Telegram-бота</span>
                                                </div>

                                                <button
                                                    type="button"
                                                    className="smart-appointment-page__verify-button"
                                                    onClick={() => void handleStartPhoneVerification()}
                                                    disabled={startingPhoneVerification || !normalizedPhone}
                                                >
                                                    {startingPhoneVerification ? 'Підготовка...' : 'Підтвердити телефон'}
                                                </button>
                                            </div>

                                            <div className="smart-appointment-page__verify-status">
                                                <span className="pending">Статус: не підтверджено</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : needsPhoneVerification ? (
                                <div className="smart-appointment-page__identity-card">
                                    <div className="smart-appointment-page__identity-head">
                                        <h4>Підтвердження телефону</h4>
                                        <p>Для першого запису потрібно додати та підтвердити номер телефону.</p>
                                    </div>

                                    <div className="smart-appointment-page__identity-grid">
                                        <label className="smart-appointment-page__field smart-appointment-page__field--wide">
                                            <span>ТЕЛЕФОН</span>
                                            <input
                                                className="smart-appointment-page__input"
                                                value={phoneInput}
                                                onChange={(e) => {
                                                    setPhoneInput(e.target.value);
                                                    setPhoneVerified(false);
                                                    setPhoneVerifiedForPhone('');
                                                }}
                                                placeholder="+380..."
                                            />
                                        </label>
                                    </div>

                                    {phoneVerified && normalizedPhone === phoneVerifiedForPhone ? (
                                        <div className="smart-appointment-page__verified-box">
                                            Телефон підтверджено
                                        </div>
                                    ) : (
                                        <div className="smart-appointment-page__verify-card">
                                            <div className="smart-appointment-page__verify-card-top">
                                                <div className="smart-appointment-page__verify-copy">
                                                    <strong>Підтвердження телефону</strong>
                                                    <span>Підтвердіть номер через Telegram-бота</span>
                                                </div>

                                                <button
                                                    type="button"
                                                    className="smart-appointment-page__verify-button"
                                                    onClick={() => void handleStartPhoneVerification()}
                                                    disabled={startingPhoneVerification || !normalizedPhone}
                                                >
                                                    {startingPhoneVerification ? 'Підготовка...' : 'Підтвердити телефон'}
                                                </button>
                                            </div>

                                            <div className="smart-appointment-page__verify-status">
                                                <span className="pending">Статус: не підтверджено</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : null}

                            <div className="smart-appointment-page__payment">
                                <h4>Спосіб оплати</h4>

                                <label className="smart-appointment-page__payment-option">
                                    <input
                                        type="radio"
                                        name="payment"
                                        checked={paymentMethod === 'offline'}
                                        onChange={() => setPaymentMethod('offline')}
                                    />
                                    <span>Оплата на місці</span>
                                </label>

                                <label className="smart-appointment-page__payment-option">
                                    <input
                                        type="radio"
                                        name="payment"
                                        checked={paymentMethod === 'online'}
                                        onChange={() => setPaymentMethod('online')}
                                    />
                                    <span>Google Pay (TEST)</span>
                                </label>
                            </div>

                            {paymentMethod === 'online' ? (
                                <div className="smart-appointment-page__google-pay-wrap">
                                    <div
                                        ref={googlePayContainerRef}
                                        className="smart-appointment-page__google-pay-button"
                                    />

                                    {!googlePayReady ? (
                                        <div className="smart-appointment-page__state">
                                            Google Pay недоступний у цьому браузері або ще не ініціалізований.
                                        </div>
                                    ) : null}

                                    {paying ? (
                                        <div className="smart-appointment-page__state">
                                            Підтвердження оплати...
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}

                            <div className="smart-appointment-page__modal-actions">
                                <button
                                    type="button"
                                    className="smart-appointment-page__secondary"
                                    onClick={() => setConfirmOpen(false)}
                                >
                                    Назад
                                </button>

                                {paymentMethod === 'offline' ? (
                                    <button
                                        type="button"
                                        className="smart-appointment-page__primary"
                                        onClick={() => void handleOfflineConfirm()}
                                    >
                                        Підтвердити запис
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {isPhoneModalOpen && telegramBotUrl ? (
                <div
                    className="smart-appointment-page__modal-backdrop"
                    onMouseDown={() => setIsPhoneModalOpen(false)}
                >
                    <div
                        className="smart-appointment-page__modal modalphone"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="smart-appointment-page__modal-body">
                            <h3>ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ</h3>

                            <TelegramQrCard
                                telegramBotUrl={telegramBotUrl}
                                title="Відкрийте Telegram"
                                subtitle="Підтвердіть номер у боті та поверніться сюди."
                                buttonLabel="Відкрити Telegram"
                            />

                            <div className="smart-appointment-page__modal-actions">
                                <button
                                    type="button"
                                    className="smart-appointment-page__secondary"
                                    onClick={() => setIsPhoneModalOpen(false)}
                                >
                                    Закрити
                                </button>

                                <button style={{display: 'none'}}
                                    type="button"
                                    className="smart-appointment-page__primary"
                                    onClick={() => void handleCheckPhoneVerification()}
                                    disabled={checkingPhoneVerification}
                                >
                                    {checkingPhoneVerification ? 'Перевірка...' : 'Я вже підтвердив'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}