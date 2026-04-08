import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { Patient } from './entities/patient.entity';
import { Appointment } from '../appointment/entities/appointment.entity';
import { PatientMedicalRecord } from '../patient-medical-record/entities/patient-medical-record.entity';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';

@Injectable()
export class PatientService {
    constructor(
        @InjectRepository(Patient)
        private readonly patientRepository: Repository<Patient>,
        private readonly dataSource: DataSource,
        private readonly phoneVerificationService: PhoneVerificationService,
        @InjectRepository(Appointment)
        private readonly appointmentRepository: Repository<Appointment>,

        @InjectRepository(PatientMedicalRecord)
        private readonly medicalRecordRepository: Repository<PatientMedicalRecord>,

    ) {}

    async findByPhone(phone: string): Promise<Patient | null> {
        return this.patientRepository.findOne({
            where: { phone },
            relations: ['user', 'medicalRecord', 'appointments'],
        });
    }

    async findById(id: string): Promise<Patient | null> {
        return this.patientRepository.findOne({
            where: { id },
            relations: ['user', 'medicalRecord', 'appointments'],
        });
    }

    async create(data: Partial<Patient>): Promise<Patient> {
        const patient = this.patientRepository.create(data);
        return this.patientRepository.save(patient);
    }

    async save(patient: Patient): Promise<Patient> {
        return this.patientRepository.save(patient);
    }

    async verifyAndLinkPhone(
        currentPatientId: string,
        phone: string,
        phoneVerificationSessionId: string,
    ) {
        const normalizedPhone = phone.trim();

        await this.phoneVerificationService.ensureVerified(
            phoneVerificationSessionId,
            normalizedPhone,
        );

        const currentPatient = await this.patientRepository.findOne({
            where: { id: currentPatientId },
            relations: ['user'],
        });

        if (!currentPatient) {
            throw new NotFoundException('Поточного пацієнта не знайдено');
        }

        const existingPatient = await this.patientRepository.findOne({
            where: { phone: normalizedPhone },
            relations: ['user'],
        });

        if (
            existingPatient &&
            existingPatient.id !== currentPatient.id &&
            existingPatient.user
        ) {
            throw new BadRequestException(
                'Цей номер телефону вже використовується іншим користувачем',
            );
        }

        if (existingPatient && existingPatient.id !== currentPatient.id) {
            const guestPatient = existingPatient;

            const guestAppointments = await this.appointmentRepository.find({
                where: {
                    patient: { id: guestPatient.id },
                },
                relations: ['patient'],
            });

            for (const appointment of guestAppointments) {
                appointment.patient = currentPatient;
            }

            if (guestAppointments.length > 0) {
                await this.appointmentRepository.save(guestAppointments);
            }

            const guestMedicalRecord = await this.medicalRecordRepository.findOne({
                where: {
                    patient: { id: guestPatient.id },
                },
                relations: ['patient'],
            });

            if (guestMedicalRecord) {
                const currentMedicalRecord = await this.medicalRecordRepository.findOne({
                    where: {
                        patient: { id: currentPatient.id },
                    },
                    relations: ['patient'],
                });

                if (!currentMedicalRecord) {
                    guestMedicalRecord.patient = currentPatient;
                    await this.medicalRecordRepository.save(guestMedicalRecord);
                } else {
                    await this.medicalRecordRepository.remove(guestMedicalRecord);
                }
            }

            guestPatient.phone = null;
            guestPatient.phoneVerified = false;
            await this.patientRepository.save(guestPatient);
            await this.patientRepository.remove(guestPatient);
        }

        currentPatient.phone = normalizedPhone;
        currentPatient.phoneVerified = true;

        return this.patientRepository.save(currentPatient);
    }

    async getAdminPatients(search: string) {
        const normalizedSearch = search.trim().toLowerCase();

        const patients = await this.patientRepository.find({
            relations: ['user', 'appointments'],
            order: {
                lastName: 'ASC',
                firstName: 'ASC',
            },
        });

        const filtered = normalizedSearch
            ? patients.filter((patient) => {
                const fullName = `${patient.lastName || ''} ${patient.firstName || ''} ${patient.middleName || ''}`
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();

                const phone = (patient.phone || '').toLowerCase();
                const email = (patient.email || '').toLowerCase();

                return (
                    fullName.includes(normalizedSearch) ||
                    phone.includes(normalizedSearch) ||
                    email.includes(normalizedSearch)
                );
            })
            : patients;

        return filtered.map((patient) => {
            const sortedAppointments = [...(patient.appointments || [])].sort((a, b) => {
                const aTime = a.appointmentDate ? new Date(a.appointmentDate).getTime() : 0;
                const bTime = b.appointmentDate ? new Date(b.appointmentDate).getTime() : 0;
                return bTime - aTime;
            });

            const lastAppointment = sortedAppointments[0] || null;

            return {
                id: patient.id,
                lastName: patient.lastName,
                firstName: patient.firstName,
                middleName: patient.middleName,
                phone: patient.phone,
                email: patient.email,
                phoneVerified: patient.phoneVerified,
                hasAccount: Boolean(patient.user),
                appointmentsCount: patient.appointments?.length || 0,
                lastAppointmentDate: lastAppointment?.appointmentDate || null,
            };
        });
    }
}