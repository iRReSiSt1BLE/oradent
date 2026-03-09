import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {

    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
    ) {}

    async create(email: string, password: string, name: string) {
        const user = this.userRepository.create({
            email,
            password,
            name,
        });

        return this.userRepository.save(user);
    }

    async findAll() {
        return this.userRepository.find();
    }

}