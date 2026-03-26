import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { StartPhoneChangeDto } from './dto/start-phone-change.dto';
import { ConfirmPhoneChangeDto } from './dto/confirm-phone-change.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
    constructor(private readonly profileService: ProfileService) {}

    @Get('me')
    getMe(@Req() req: { user: { id: string } }) {
        return this.profileService.getMyProfile(req.user.id);
    }

    @Patch()
    updateProfile(
        @Req() req: { user: { id: string } },
        @Body() dto: UpdateProfileDto,
    ) {
        return this.profileService.updateProfile(req.user.id, dto);
    }

    @Post('change-password')
    changePassword(
        @Req() req: { user: { id: string } },
        @Body() dto: ChangePasswordDto,
    ) {
        return this.profileService.changePassword(req.user.id, dto);
    }

    @Post('change-email/request')
    requestEmailChange(
        @Req() req: { user: { id: string } },
        @Body() dto: RequestEmailChangeDto,
    ) {
        return this.profileService.requestEmailChange(req.user.id, dto);
    }

    @Post('change-email/confirm')
    confirmEmailChange(
        @Req() req: { user: { id: string } },
        @Body() dto: ConfirmEmailChangeDto,
    ) {
        return this.profileService.confirmEmailChange(req.user.id, dto);
    }

    @Post('change-phone/start')
    startPhoneChange(
        @Req() req: { user: { id: string } },
        @Body() dto: StartPhoneChangeDto,
    ) {
        return this.profileService.startPhoneChange(req.user.id, dto);
    }

    @Post('change-phone/confirm')
    confirmPhoneChange(
        @Req() req: { user: { id: string } },
        @Body() dto: ConfirmPhoneChangeDto,
    ) {
        return this.profileService.confirmPhoneChange(req.user.id, dto);
    }
}
