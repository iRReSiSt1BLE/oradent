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
            html: `
  <div style="margin:0;padding:32px 12px;background:#eceff1;font-family:'IBM Plex Mono',Consolas,'Courier New',monospace;">
    <div style="
      max-width:640px;
      margin:0 auto;
      background:#f8f8f8;
      border:1.5px solid #111111;
      border-radius:14px;
      box-shadow:8px 8px 0 #111111;
      overflow:hidden;
    ">
      
      <div style="
        background:#84d8ce;
        padding:14px 20px;
        text-align:center;
        border-bottom:1.5px solid #111111;
      ">
        <div style="
          color:#ffffff;
          font-size:12px;
          font-weight:700;
          letter-spacing:0.28em;
          text-transform:uppercase;
        ">
          ORADENT · EMAIL VERIFICATION
        </div>
      </div>

      <div style="padding:28px 24px 24px;">
        <h1 style="
          margin:0 0 18px;
          text-align:center;
          font-size:34px;
          line-height:1.1;
          font-weight:700;
          color:#111111;
          text-transform:uppercase;
        ">
          ПІДТВЕРДЖЕННЯ ПОШТИ
        </h1>

        <p style="
          margin:0 0 18px;
          color:#111111;
          font-size:15px;
          line-height:1.7;
          text-align:center;
        ">
          Щоб завершити реєстрацію, введіть цей код у формі підтвердження.
        </p>

        <div style="
          margin:0 0 20px;
          padding:18px 16px;
          border:2px solid #111111;
          background:#ffffff;
          text-align:center;
        ">
          <div style="
            font-size:13px;
            font-weight:700;
            color:#374151;
            text-transform:uppercase;
            letter-spacing:0.08em;
            margin-bottom:10px;
          ">
            Ваш код
          </div>

          <div style="
            color:#111111;
            font-size:36px;
            line-height:1;
            font-weight:700;
            letter-spacing:0.22em;
            user-select:all;
            -webkit-user-select:all;
            -moz-user-select:all;
          ">
            ${code}
          </div>
        </div>

        <p style="
          margin:0 0 18px;
          color:#4b5563;
          font-size:13px;
          line-height:1.7;
          text-align:center;
        ">
          Код дійсний протягом <b>10 хвилин</b>. Не передавайте його нікому.
        </p>

        <div style="
          padding-top:18px;
          border-top:1px solid #d1d5db;
        ">
          <p style="
            margin:0;
            color:#6b7280;
            font-size:12px;
            line-height:1.7;
            text-align:center;
          ">
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