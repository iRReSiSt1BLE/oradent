import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('api/db-test')
export class DatabaseController {
    constructor(private readonly dataSource: DataSource) {}

    @Get()
    async testDb() {
        const result = await this.dataSource.query('SELECT 1 AS connected');

        return {
            ok: true,
            db: result,
        };
    }
}