import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Patient } from './entities/patient.entity';

@Injectable()
export class PatientService {
    constructor(
        @InjectRepository(Patient)
        private readonly patientRepository: Repository<Patient>,
    ) {}

    async findByPhone(phone: string): Promise<Patient | null> {
        return this.patientRepository.findOne({
            where: { phone },
            relations: ['user', 'medicalRecord'],
        });
    }

    async findById(id: string): Promise<Patient | null> {
        return this.patientRepository.findOne({
            where: { id },
            relations: ['user', 'medicalRecord'],
        });
    }

    async create(data: Partial<Patient>): Promise<Patient> {
        const patient = this.patientRepository.create(data);
        return this.patientRepository.save(patient);
    }

    async save(patient: Patient): Promise<Patient> {
        return this.patientRepository.save(patient);
    }

    async setPhone(patientId: string, phone: string): Promise<Patient> {
        const patient = await this.findById(patientId);

        if (!patient) {
            throw new BadRequestException('Пацієнта не знайдено');
        }

        const existingPatientWithPhone = await this.patientRepository.findOne({
            where: {
                phone,
                id: Not(patientId),
            },
        });

        if (existingPatientWithPhone) {
            throw new BadRequestException('Цей номер уже використовується');
        }

        patient.phone = phone;
        patient.phoneVerified = false;

        return this.patientRepository.save(patient);
    }

    async confirmPhone(patientId: string): Promise<Patient> {
        const patient = await this.findById(patientId);

        if (!patient) {
            throw new BadRequestException('Пацієнта не знайдено');
        }

        if (!patient.phone) {
            throw new BadRequestException('У пацієнта відсутній номер телефону');
        }

        patient.phoneVerified = true;
        return this.patientRepository.save(patient);
    }
}