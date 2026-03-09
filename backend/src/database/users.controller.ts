import { Controller, Get, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {

    constructor(private readonly usersService: UsersService) {}

    @Post()
    create(@Body() body: any) {
        return this.usersService.create(
            body.email,
            body.password,
            body.name,
        );
    }

    @Get()
    findAll() {
        return this.usersService.findAll();
    }

}