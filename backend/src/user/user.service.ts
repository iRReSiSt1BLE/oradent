import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    async findByEmail(email: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { email: email.trim().toLowerCase() },
            relations: ['patient'],
        });
    }

    async findByGoogleId(googleId: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { googleId },
            relations: ['patient'],
        });
    }

    async findById(id: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { id },
            relations: ['patient'],
        });
    }

    async findByIds(ids: string[]): Promise<User[]> {
        if (!ids.length) {
            return [];
        }

        return this.userRepository.find({
            where: { id: In(ids) },
            relations: ['patient'],
        });
    }

    async findByRole(role: UserRole): Promise<User[]> {
        return this.userRepository.find({
            where: { role },
            relations: ['patient'],
            order: { email: 'ASC' },
        });
    }

    async save(user: User): Promise<User> {
        return this.userRepository.save(user);
    }

    create(data: Partial<User>): User {
        return this.userRepository.create(data);
    }
}
