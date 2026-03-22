import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { PendingRegistration } from './entities/pending-registration.entity';

@Injectable()
export class PendingRegistrationService {
    constructor(
        @InjectRepository(PendingRegistration)
        private readonly pendingRegistrationRepository: Repository<PendingRegistration>,
    ) {}

    async findByEmail(email: string): Promise<PendingRegistration | null> {
        return this.pendingRegistrationRepository.findOne({
            where: { email },
        });
    }

    async createOrReplace(data: Partial<PendingRegistration>) {
        const existing = await this.findByEmail(data.email!);

        if (existing) {
            await this.pendingRegistrationRepository.remove(existing);
        }

        const entity = this.pendingRegistrationRepository.create(data);
        return this.pendingRegistrationRepository.save(entity);
    }

    async remove(entity: PendingRegistration) {
        return this.pendingRegistrationRepository.remove(entity);
    }

    async deleteExpired(): Promise<void> {
        await this.pendingRegistrationRepository.delete({
            expiresAt: LessThan(new Date()),
        });
    }
}