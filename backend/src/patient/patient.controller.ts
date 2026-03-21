import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PatientService } from './patient.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SetPhoneDto } from './dto/set-phone.dto';
import { ConfirmPhoneDto } from './dto/confirm-phone.dto';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';

@Controller('patient')
export class PatientController {
    constructor(
        private readonly patientService: PatientService,
        private readonly userService: UserService,
        private readonly phoneVerificationService: PhoneVerificationService,
    ) {}

    @UseGuards(JwtAuthGuard)
    @Get('me')
    async getMyPatient(@Req() req: { user: { id: string } }) {
        const user = await this.userService.findById(req.user.id);

        if (!user || !user.patient) {
            return {
                ok: false,
                message: 'Пацієнта не знайдено',
            };
        }

        return {
            ok: true,
            patient: user.patient,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('phone')
    async setPhone(
        @Req() req: { user: { id: string } },
        @Body() dto: SetPhoneDto,
    ) {
        const user = await this.userService.findById(req.user.id);

        if (!user || !user.patient) {
            return {
                ok: false,
                message: 'Пацієнта не знайдено',
            };
        }

        const patient = await this.patientService.setPhone(user.patient.id, dto.phone);

        return {
            ok: true,
            message: 'Номер телефону збережено',
            patient: {
                id: patient.id,
                phone: patient.phone,
                phoneVerified: patient.phoneVerified,
            },
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('phone/confirm')
    async confirmPhone(
        @Req() req: { user: { id: string } },
        @Body() dto: ConfirmPhoneDto,
    ) {
        const user = await this.userService.findById(req.user.id);

        if (!user || !user.patient) {
            return {
                ok: false,
                message: 'Пацієнта не знайдено',
            };
        }

        if (!user.patient.phone) {
            return {
                ok: false,
                message: 'Спочатку збережи номер телефону',
            };
        }

        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            user.patient.phone,
        );

        const patient = await this.patientService.confirmPhone(user.patient.id);

        return {
            ok: true,
            message: 'Номер телефону підтверджено',
            patient: {
                id: patient.id,
                phone: patient.phone,
                phoneVerified: patient.phoneVerified,
            },
        };
    }
}