import { BadRequestException, Injectable } from '@nestjs/common';
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
        accountPatientId: string,
        phone: string,
        phoneVerificationSessionId: string,
    ): Promise<Patient> {
        await this.phoneVerificationService.ensureVerified(
            phoneVerificationSessionId,
            phone,
        );

        const accountPatient = await this.patientRepository.findOne({
            where: { id: accountPatientId },
            relations: ['user', 'medicalRecord', 'appointments'],
        });

        if (!accountPatient) {
            throw new BadRequestException('Пацієнта акаунта не знайдено');
        }

        const existingPatientWithPhone = await this.patientRepository.findOne({
            where: {
                phone,
                id: Not(accountPatientId),
            },
            relations: ['user', 'medicalRecord', 'appointments'],
        });

        if (
            existingPatientWithPhone &&
            existingPatientWithPhone.user &&
            existingPatientWithPhone.user.id !== accountPatient.user?.id
        ) {
            throw new BadRequestException('Цей номер уже використовується іншим акаунтом');
        }

        return this.dataSource.transaction(async (manager) => {
            const patientRepo = manager.getRepository(Patient);
            const appointmentRepo = manager.getRepository(Appointment);
            const medicalRecordRepo = manager.getRepository(PatientMedicalRecord);

            const freshAccountPatient = await patientRepo.findOne({
                where: { id: accountPatientId },
                relations: ['user', 'medicalRecord'],
            });

            if (!freshAccountPatient) {
                throw new BadRequestException('Пацієнта акаунта не знайдено');
            }

            const guestPatient = await patientRepo.findOne({
                where: {
                    phone,
                    id: Not(accountPatientId),
                },
                relations: ['user', 'medicalRecord', 'appointments'],
            });

            if (guestPatient && !guestPatient.user) {
                await appointmentRepo
                    .createQueryBuilder()
                    .update(Appointment)
                    .set({ patient: freshAccountPatient })
                    .where('patientId = :patientId', { patientId: guestPatient.id })
                    .execute();

                if (guestPatient.medicalRecord && !freshAccountPatient.medicalRecord) {
                    await medicalRecordRepo
                        .createQueryBuilder()
                        .update(PatientMedicalRecord)
                        .set({ patient: freshAccountPatient })
                        .where('id = :id', { id: guestPatient.medicalRecord.id })
                        .execute();
                }

                await patientRepo.delete(guestPatient.id);
            }

            freshAccountPatient.phone = phone;
            freshAccountPatient.phoneVerified = true;

            return patientRepo.save(freshAccountPatient);
        });
    }
}