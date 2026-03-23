import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

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

    async save(user: User): Promise<User> {
        return this.userRepository.save(user);
    }


}