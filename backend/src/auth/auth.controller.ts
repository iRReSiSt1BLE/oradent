import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {}

    @Post('register')
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('verify-email')
    verifyEmail(@Body() dto: VerifyEmailDto) {
        return this.authService.verifyEmail(dto);
    }

    @Post('login')
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    me(@Req() req: { user: { id: string } }) {
        return this.authService.getMe(req.user.id);
    }

    @Get('google')
    @UseGuards(GoogleAuthGuard)
    async googleAuth() {
        return;
    }

    @Get('google/callback')
    @UseGuards(GoogleAuthGuard)
    async googleAuthCallback(
        @Req() req: {
            user: {
                googleId: string;
                email: string | null;
                firstName: string;
                lastName: string;
            };
        },
        @Res() res: Response,
    ) {
        const frontendUrl =
            this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

        try {
            const result = await this.authService.googleLogin(req.user);

            return res.redirect(
                `${frontendUrl}/login/success?token=${encodeURIComponent(
                    result.accessToken,
        )}`,
        );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Помилка входу через Google';

            return res.redirect(
                `${frontendUrl}/login?googleError=${encodeURIComponent(message)}`,
        );
        }
    }
}