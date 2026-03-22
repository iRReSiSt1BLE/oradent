import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PatientService } from './patient.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifyAndLinkPhoneDto } from './dto/verify-and-link-phone.dto';

@Controller('patient')
export class PatientController {
    constructor(
        private readonly patientService: PatientService,
        private readonly userService: UserService,
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
    @Post('phone/verify-and-link')
    async verifyAndLinkPhone(
        @Req() req: { user: { id: string } },
        @Body() dto: VerifyAndLinkPhoneDto,
    ) {
        const user = await this.userService.findById(req.user.id);

        if (!user || !user.patient) {
            return {
                ok: false,
                message: 'Пацієнта не знайдено',
            };
        }

        const patient = await this.patientService.verifyAndLinkPhone(
            user.patient.id,
            dto.phone,
            dto.phoneVerificationSessionId,
        );

        return {
            ok: true,
            message: 'Номер телефону підтверджено і прив’язано до акаунта',
            patient: {
                id: patient.id,
                phone: patient.phone,
                phoneVerified: patient.phoneVerified,
            },
        };
    }
}