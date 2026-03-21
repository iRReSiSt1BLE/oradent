import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;

    constructor(private readonly configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get('MAIL_HOST'),
            port: Number(this.configService.get('MAIL_PORT')),
            secure: this.configService.get('MAIL_SECURE') === 'true',
            auth: {
                user: this.configService.get('MAIL_USER'),
                pass: this.configService.get('MAIL_PASS'),
            },
        });
    }

    async sendVerificationEmail(to: string, code: string) {
        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'Підтвердження пошти',
            html:`
                <div style="margin:0;padding:32px 12px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">
                <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

                <div style="background:linear-gradient(135deg,#1d4ed8,#2563eb);padding:32px 24px;text-align:center;">
                <div style="
            display:inline-block;
            background:rgba(255,255,255,0.14);
            color:#ffffff;
            padding:10px 18px;
            border-radius:999px;
        font-size:14px;
        font-weight:700;
        letter-spacing:0.5px;
        ">
        ORADENT
        </div>
        <h1 style="margin:18px 0 0;font-size:30px;line-height:1.2;color:#ffffff;">
            Підтвердження пошти
        </h1>
        <p style="margin:14px auto 0;max-width:420px;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.92);">
            Щоб завершити реєстрацію, використайте код підтвердження нижче.
        </p>
        </div>

        <div style="padding:36px 28px 32px;">
        <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;text-align:center;">
            Введіть цей код у формі підтвердження пошти:
            </p>

            <div style="text-align:center;margin:24px 0 10px;">
        <div style="
        display:inline-block;
        min-width:260px;
        background:#f8fafc;
        border:2px dashed #cbd5e1;
        border-radius:20px;
        padding:22px 28px;
        color:#111827;
        font-size:36px;
        font-weight:800;
        letter-spacing:10px;
        text-align:center;
        user-select:all;
        -webkit-user-select:all;
        -moz-user-select:all;
        ">
        ${code}
        </div>
        </div>

        <p style="margin:12px 0 0;color:#6b7280;font-size:13px;line-height:1.6;text-align:center;">
            Натисніть і виділіть код, щоб швидко його скопіювати
        </p>

        <div style="
        margin:30px 0 0;
        background:#eff6ff;
        border:1px solid #bfdbfe;
        border-radius:16px;
        padding:16px 18px;
        ">
        <p style="margin:0;color:#1e3a8a;font-size:14px;line-height:1.7;text-align:center;">
            Код дійсний протягом <b>10 хвилин</b>. Нікому його не повідомляйте.
        </p>
        </div>

        <div style="margin-top:30px;padding-top:22px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.7;text-align:center;">
            Якщо ви не створювали акаунт у системі Oradent, просто проігноруйте цей лист.
        </p>
        </div>
        </div>
        </div>
        </div>
            `,
    });
    }
}