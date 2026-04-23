import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

@Injectable()
export class UserService {
    private readonly logger = new Logger(UserService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    private isRetryableDatabaseError(error: unknown): boolean {
        const value = error as { code?: string; message?: string } | undefined;
        const code = String(value?.code || '').toUpperCase();
        const message = String(value?.message || '').toUpperCase();

        return (
            code === 'ECONNRESET' ||
            code === 'ETIMEDOUT' ||
            code === 'ECONNREFUSED' ||
            code === 'PROTOCOL_CONNECTION_LOST' ||
            code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
            message.includes('ECONNRESET') ||
            message.includes('PROTOCOL_CONNECTION_LOST')
        );
    }

    private async withTransientDbRetry<T>(operationName: string, handler: () => Promise<T>): Promise<T> {
        try {
            return await handler();
        } catch (error) {
            if (!this.isRetryableDatabaseError(error)) {
                throw error;
            }

            this.logger.warn(`${operationName} failed with transient DB error. Retrying once.`);
            await new Promise((resolve) => setTimeout(resolve, 150));
            return handler();
        }
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.withTransientDbRetry('UserService.findByEmail', () =>
            this.userRepository.findOne({
                where: { email: email.trim().toLowerCase() },
                relations: ['patient'],
            }),
        );
    }

    async findByGoogleId(googleId: string): Promise<User | null> {
        return this.withTransientDbRetry('UserService.findByGoogleId', () =>
            this.userRepository.findOne({
                where: { googleId },
                relations: ['patient'],
            }),
        );
    }

    async findById(id: string): Promise<User | null> {
        return this.withTransientDbRetry('UserService.findById', () =>
            this.userRepository.findOne({
                where: { id },
                relations: ['patient'],
            }),
        );
    }

    async findByIds(ids: string[]): Promise<User[]> {
        if (!ids.length) {
            return [];
        }

        return this.withTransientDbRetry('UserService.findByIds', () =>
            this.userRepository.find({
                where: { id: In(ids) },
                relations: ['patient'],
            }),
        );
    }

    async findByRole(role: UserRole): Promise<User[]> {
        return this.withTransientDbRetry('UserService.findByRole', () =>
            this.userRepository.find({
                where: { role },
                relations: ['patient'],
                order: { email: 'ASC' },
            }),
        );
    }

    async save(user: User): Promise<User> {
        return this.userRepository.save(user);
    }

    create(data: Partial<User>): User {
        return this.userRepository.create(data);
    }
}
