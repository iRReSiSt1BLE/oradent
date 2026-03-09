import { Controller, Get } from '@nestjs/common';

@Controller('api/health')
export class HealthController {
    @Get()
    getHealth() {
        return {
            ok: true,
            message: 'Backend is working',
            timestamp: new Date().toISOString(),
        };
    }
}