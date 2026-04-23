import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
const PDFDocument = require('pdfkit');

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
    private resolvePdfFontPath() {
        const candidates = [
            join(process.cwd(), 'src', 'common', 'assets', 'fonts', 'DejaVuSans.ttf'),
            join(process.cwd(), 'dist', 'common', 'assets', 'fonts', 'DejaVuSans.ttf'),
            join(__dirname, '..', 'common', 'assets', 'fonts', 'DejaVuSans.ttf'),
            join(__dirname, '..', '..', 'common', 'assets', 'fonts', 'DejaVuSans.ttf'),
        ];

        const found = candidates.find((path) => existsSync(path));

        if (!found) {
            throw new Error(
                'Не знайдено файл шрифту DejaVuSans.ttf. Поклади реальний TTF у src/common/assets/fonts/DejaVuSans.ttf',
            );
        }

        return found;
    }

    private escapeHtml(value: string) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private formatDateTimeUa(value: Date | string | null | undefined) {
        if (!value) return 'Дата не вказана';

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Дата не вказана';

        return date.toLocaleString('uk-UA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    private async buildReceiptPdf(params: {
        patientName: string;
        receiptNumber: string;
        appointmentDate: Date | null;
        amountUah: number;
        appointmentLines: string[];
    }) {
        const { patientName, receiptNumber, appointmentDate, amountUah, appointmentLines } = params;

        const fontPath = this.resolvePdfFontPath();

        return await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 36,
                info: {
                    Title: 'Квитанція ORADENT',
                    Author: 'ORADENT',
                    Subject: 'Підтвердження запису',
                },
            });

            const chunks: Buffer[] = [];

            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            doc.font(fontPath);

            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const left = 42;
            const right = pageWidth - 42;
            const width = right - left;
            const bottomSafeY = pageHeight - 90;

            const colors = {
                border: '#1f2937',
                muted: '#6b7280',
                text: '#111827',
                accent: '#7fd6cb',
                soft: '#eef7f6',
                white: '#ffffff',
            };

            const formatMoney = (value: number) =>
                `${Number(value || 0).toFixed(2).replace('.00', '')} грн`;

            const rows = appointmentLines.map((line, index) => {
                const parts = line.split(' — ');
                return {
                    no: String(index + 1),
                    service: parts[0] || 'Послуга',
                    date: parts[1] || 'Дата не вказана',
                    doctor: parts.slice(2).join(' — ') || 'Лікар не вказаний',
                };
            });

            const drawHeader = () => {
                doc.roundedRect(left, 28, width, pageHeight - 56, 12).lineWidth(1).stroke(colors.border);

                doc.rect(left, 28, width, 34).fillAndStroke(colors.accent, colors.border);

                doc
                    .font(fontPath)
                    .fontSize(13)
                    .fillColor(colors.white)
                    .text('ORADENT', left, 39, {
                        width,
                        align: 'center',
                        characterSpacing: 3,
                    });

                doc
                    .font(fontPath)
                    .fontSize(22)
                    .fillColor(colors.text)
                    .text('КВИТАНЦІЯ ПРО ЗАПИС', left, 82, {
                        width,
                        align: 'center',
                    });

                doc
                    .font(fontPath)
                    .fontSize(10)
                    .fillColor(colors.muted)
                    .text('Документ підтверджує створення запису в системі ORADENT', left, 112, {
                        width,
                        align: 'center',
                    });
            };

            const drawInfoBox = (startY: number) => {
                const infoBoxHeight = 148;

                doc.roundedRect(left + 16, startY, width - 32, infoBoxHeight, 10).lineWidth(1).stroke(colors.border);

                const drawLabelValue = (
                    x: number,
                    y: number,
                    label: string,
                    value: string,
                    valueOffset = 165,
                ) => {
                    doc.font(fontPath).fontSize(10).fillColor(colors.muted).text(label, x, y);
                    doc.font(fontPath).fontSize(12).fillColor(colors.text).text(value, x + valueOffset, y - 1, {
                        width: width - valueOffset - 70,
                    });
                };

                drawLabelValue(left + 30, startY + 18, 'Номер квитанції', receiptNumber);
                drawLabelValue(left + 30, startY + 44, 'Пацієнт', patientName);
                drawLabelValue(left + 30, startY + 70, 'Дата створення', this.formatDateTimeUa(new Date()));
                drawLabelValue(left + 30, startY + 96, 'Дата першого запису', this.formatDateTimeUa(appointmentDate));
                drawLabelValue(left + 30, startY + 122, 'Загальна сума', formatMoney(amountUah));

                return startY + infoBoxHeight + 22;
            };

            const drawTableHeader = (startY: number) => {
                const tableLeft = left + 16;
                const tableWidth = width - 32;

                const colNo = 36;
                const colService = 370;
                const colDate = tableWidth - colNo - colService;

                doc
                    .font(fontPath)
                    .fontSize(14)
                    .fillColor(colors.text)
                    .text('Перелік послуг', left + 18, startY);

                const headerY = startY + 24;

                doc.rect(tableLeft, headerY, tableWidth, 30).fillAndStroke(colors.accent, colors.border);

                doc.font(fontPath).fontSize(10).fillColor(colors.text);
                doc.text('№', tableLeft + 10, headerY + 10, { width: colNo - 12 });
                doc.text('Послуга та лікар', tableLeft + colNo + 8, headerY + 10, { width: colService - 16 });
                doc.text('Дата і час', tableLeft + colNo + colService + 8, headerY + 10, { width: colDate - 16 });

                return {
                    y: headerY + 30,
                    tableLeft,
                    tableWidth,
                    colNo,
                    colService,
                    colDate,
                };
            };

            drawHeader();

            let y = 148;
            y = drawInfoBox(y);

            let table = drawTableHeader(y);
            y = table.y;

            rows.forEach((row, rowIndex) => {
                const serviceText = row.service;
                const doctorText = `Лікар: ${row.doctor}`;

                const serviceHeight = doc.heightOfString(serviceText, {
                    width: table.colService - 16,
                    align: 'left',
                });

                const doctorHeight = doc.heightOfString(doctorText, {
                    width: table.colService - 16,
                    align: 'left',
                });

                const dateHeight = doc.heightOfString(row.date, {
                    width: table.colDate - 16,
                    align: 'left',
                });

                const rowHeight = Math.max(64, Math.max(serviceHeight + doctorHeight + 16, dateHeight + 20));

                if (y + rowHeight + 90 > bottomSafeY) {
                    doc.addPage();
                    drawHeader();
                    y = 60;
                    y = drawInfoBox(y);
                    table = drawTableHeader(y);
                    y = table.y;
                }

                const fill = rowIndex % 2 === 0 ? colors.white : colors.soft;

                doc.rect(table.tableLeft, y, table.tableWidth, rowHeight).fillAndStroke(fill, colors.border);

                doc.font(fontPath).fontSize(10).fillColor(colors.text);
                doc.text(row.no, table.tableLeft + 10, y + 10, {
                    width: table.colNo - 12,
                });

                doc.font(fontPath).fontSize(12).fillColor(colors.text);
                doc.text(serviceText, table.tableLeft + table.colNo + 8, y + 10, {
                    width: table.colService - 16,
                    lineGap: 2,
                });

                doc.font(fontPath).fontSize(10).fillColor(colors.muted);
                doc.text(doctorText, table.tableLeft + table.colNo + 8, y + 34, {
                    width: table.colService - 16,
                    lineGap: 2,
                });

                doc.font(fontPath).fontSize(12).fillColor(colors.text);
                doc.text(row.date, table.tableLeft + table.colNo + table.colService + 8, y + 10, {
                    width: table.colDate - 16,
                    lineGap: 2,
                });

                y += rowHeight;
            });

            y += 22;

            if (y + 68 > bottomSafeY) {
                doc.addPage();
                drawHeader();
                y = 60;
            }

            doc.roundedRect(left + 16, y, width - 32, 68, 10).lineWidth(1).stroke(colors.border);

            doc
                .font(fontPath)
                .fontSize(11)
                .fillColor(colors.text)
                .text(
                    'Ця квитанція сформована автоматично та є підтвердженням запису на прийом у клініці ORADENT.',
                    left + 28,
                    y + 18,
                    {
                        width: width - 56,
                        align: 'center',
                        lineGap: 3,
                    },
                );

            doc.end();
        });
    }

    private async sendCodeEmail(params: {
        to: string;
        subject: string;
        title: string;
        description: string;
        code: string;
    }) {
        const { to, subject, title, description, code } = params;

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject,
            html:
                `<div style="margin:0;padding:32px 12px;background:#eceff1;font-family:'IBM Plex Mono',Consolas,'Courier New',monospace;">
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
        ORADENT
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
        ${title}
        </h1>

        <p style="
        margin:0 0 18px;
        color:#111111;
        font-size:15px;
        line-height:1.7;
        text-align:center;
        ">
        ${description}
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
        </div>
        </div>
        </div>
            `,
    });
    }

    async sendVerificationEmail(to: string, code: string) {
        await this.sendCodeEmail({
            to,
            subject: 'Підтвердження пошти',
            title: 'ПІДТВЕРДЖЕННЯ ПОШТИ',
            description: 'Щоб завершити реєстрацію, введіть цей код у формі підтвердження.',
            code,
        });
    }

    async sendEmailChangeCode(to: string, code: string) {
        await this.sendCodeEmail({
            to,
            subject: 'Підтвердження зміни пошти',
            title: 'ЗМІНА EMAIL',
            description: 'Щоб підтвердити нову пошту, введіть цей код у профілі.',
            code,
        });
    }



    private buildEmailShell(title: string, bodyHtml: string) {
        return `
            <div style="margin:0;padding:32px 12px;background:#eceff1;font-family:'IBM Plex Mono',Consolas,'Courier New',monospace;">
                <div style="max-width:640px;margin:0 auto;background:#f8f8f8;border:1.5px solid #111111;border-radius:14px;box-shadow:8px 8px 0 #111111;overflow:hidden;">
                    <div style="background:#84d8ce;padding:14px 20px;text-align:center;border-bottom:1.5px solid #111111;">
                        <div style="color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;">ORADENT</div>
                    </div>
                    <div style="padding:28px 24px 24px;">
                        <h1 style="margin:0 0 18px;text-align:center;font-size:28px;line-height:1.15;font-weight:700;color:#111111;text-transform:uppercase;">${title}</h1>
                        ${bodyHtml}
                    </div>
                </div>
            </div>
        `;
    }

    private async buildAppointmentNoticePdfBuffer(params: {
        title: string;
        patientName: string;
        summary?: string;
        appointmentLines: string[];
        footerNote?: string;
        extraRows?: Array<{ label: string; value: string }>;
    }) {
        const { title, patientName, summary, appointmentLines, footerNote, extraRows = [] } = params;
        const fontPath = this.resolvePdfFontPath();

        return await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 42,
                info: {
                    Title: `${title} ORADENT`,
                    Author: 'ORADENT',
                    Subject: title,
                },
            });

            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            doc.font(fontPath);

            const pageWidth = doc.page.width;
            const left = 42;
            const right = pageWidth - 42;
            const width = right - left;
            const colors = {
                text: '#111827',
                muted: '#4b5563',
                line: '#9ca3af',
            };

            const drawHeader = () => {
                doc.font(fontPath).fontSize(11).fillColor(colors.muted).text('ORADENT', left, 32, { width, align: 'right' });
                doc.font(fontPath).fontSize(24).fillColor(colors.text).text(title, left, 72, { width, align: 'left' });
                doc.moveTo(left, 108).lineTo(right, 108).lineWidth(1).stroke(colors.line);
                doc.y = 126;
            };

            const ensureSpace = (requiredHeight: number) => {
                if (doc.y + requiredHeight <= doc.page.height - 60) return;
                doc.addPage();
                drawHeader();
            };

            const drawInfoRow = (label: string, value: string) => {
                ensureSpace(22);
                doc.font(fontPath).fontSize(11).fillColor(colors.muted).text(label, left, doc.y, { continued: true });
                doc.font(fontPath).fontSize(12).fillColor(colors.text).text(` ${value}`);
                doc.moveDown(0.25);
            };

            const drawListSection = (sectionTitle: string, items: string[]) => {
                const normalized = items.filter((item) => item.trim());
                ensureSpace(34);
                doc.moveDown(0.35);
                doc.font(fontPath).fontSize(15).fillColor(colors.text).text(sectionTitle, left, doc.y, { width });
                doc.moveDown(0.25);

                if (!normalized.length) {
                    doc.font(fontPath).fontSize(11).fillColor(colors.muted).text('Не вказано', left, doc.y, { width });
                    doc.moveDown(0.6);
                    return;
                }

                normalized.forEach((item, index) => {
                    const itemText = `${index + 1}. ${item}`;
                    const itemHeight = doc.heightOfString(itemText, { width, lineGap: 3 });
                    ensureSpace(itemHeight + 8);
                    doc.font(fontPath).fontSize(11).fillColor(colors.text).text(itemText, left, doc.y, { width, lineGap: 3 });
                    doc.moveDown(0.2);
                });

                doc.moveDown(0.4);
            };

            drawHeader();
            drawInfoRow('Пацієнт:', patientName);
            extraRows.forEach((row) => drawInfoRow(row.label, row.value));

            if (summary) {
                ensureSpace(72);
                doc.moveDown(0.4);
                doc.font(fontPath).fontSize(15).fillColor(colors.text).text('Опис', left, doc.y, { width });
                doc.moveDown(0.25);
                doc.font(fontPath).fontSize(11).fillColor(colors.text).text(summary, left, doc.y, { width, lineGap: 4 });
                doc.moveDown(0.7);
            }

            drawListSection('Деталі запису', appointmentLines);

            if (footerNote) {
                ensureSpace(40);
                doc.font(fontPath).fontSize(11).fillColor(colors.muted).text(footerNote, left, doc.y, { width, lineGap: 3 });
                doc.moveDown(0.6);
            }

            doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).stroke(colors.line);
            doc.moveDown(0.7);
            doc.font(fontPath).fontSize(11).fillColor(colors.muted).text('Документ сформовано автоматично в системі ORADENT.', left, doc.y, { width, align: 'left' });
            doc.end();
        });
    }

    async sendPaidAppointmentConfirmation(params: {
        to: string;
        patientName: string;
        appointmentDate: Date | null;
        amountUah: number;
        appointmentLines: string[];
        receiptNumber?: string;
    }) {
        const {
            to,
            patientName,
            appointmentDate,
            amountUah,
            appointmentLines,
            receiptNumber,
        } = params;

        const resolvedReceiptNumber =
            receiptNumber ||
            `ORADENT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

        const pdfBuffer = await this.buildAppointmentNoticePdfBuffer({
            title: 'ПІДТВЕРДЖЕННЯ ЗАПИСУ',
            patientName,
            summary: 'Ваш запис успішно створено. Нижче наведено деталі візиту та параметри підтвердження.',
            appointmentLines,
            footerNote: 'PDF-файл можна використовувати як підтвердження запису.',
            extraRows: [
                { label: 'Дата першого візиту:', value: this.formatDateTimeUa(appointmentDate) },
                { label: 'Сума:', value: `${Number(amountUah || 0).toFixed(2).replace('.00', '')} грн` },
                { label: 'Номер документа:', value: resolvedReceiptNumber },
            ],
        });

        const linesHtml = appointmentLines.length
            ? appointmentLines.map((line) => `<li style="margin:0 0 10px;">${this.escapeHtml(line)}</li>`).join('')
            : '<li>Дані про послуги не вказані</li>';

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'ORADENT — підтвердження запису',
            html: this.buildEmailShell(
                'ПІДТВЕРДЖЕННЯ ЗАПИСУ',
                `
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#111111;">Добрий день, <strong>${this.escapeHtml(patientName)}</strong>.</p>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#111111;">До листа прикріплено PDF-файл з підтвердженням запису.</p>
                    <div style="margin:0 0 18px;padding:18px;border:1.5px solid #111111;background:#ffffff;">
                        <div style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111111;">Деталі запису:</div>
                        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#111111;">${linesHtml}</ul>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;text-align:center;">Дата першого візиту: ${this.escapeHtml(this.formatDateTimeUa(appointmentDate))} · Сума: ${this.escapeHtml(`${Number(amountUah || 0).toFixed(2).replace('.00', '')} грн`)}</p>
                `,
            ),
            attachments: [
                {
                    filename: `appointment-confirmation-${resolvedReceiptNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
    }



    private formatDateOnlyUa(value: Date | string | null | undefined) {
        if (!value) return 'Дата не вказана';

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Дата не вказана';

        return date.toLocaleDateString('uk-UA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    }

    async buildConsultationPdfBuffer(params: {
        patientName: string;
        doctorName: string;
        appointmentDate: Date | string | null;
        conclusion: string;
        treatmentPlanItems: string[];
        recommendationItems: string[];
        medicationItems: string[];
        nextVisitDate?: Date | string | null;
    }) {
        const {
            patientName,
            doctorName,
            appointmentDate,
            conclusion,
            treatmentPlanItems,
            recommendationItems,
            medicationItems,
            nextVisitDate,
        } = params;

        const fontPath = this.resolvePdfFontPath();

        return await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 42,
                info: {
                    Title: 'Консультативний висновок ORADENT',
                    Author: 'ORADENT',
                    Subject: 'Консультативний висновок',
                },
            });

            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            doc.font(fontPath);

            const pageWidth = doc.page.width;
            const left = 42;
            const right = pageWidth - 42;
            const width = right - left;

            const colors = {
                text: '#111827',
                muted: '#4b5563',
                line: '#9ca3af',
            };

            const drawHeader = () => {
                doc
                    .font(fontPath)
                    .fontSize(11)
                    .fillColor(colors.muted)
                    .text('ORADENT', left, 32, { width, align: 'right' });

                doc
                    .font(fontPath)
                    .fontSize(24)
                    .fillColor(colors.text)
                    .text('КОНСУЛЬТАТИВНИЙ ВИСНОВОК', left, 72, {
                        width,
                        align: 'left',
                    });

                doc.moveTo(left, 108).lineTo(right, 108).lineWidth(1).stroke(colors.line);
                doc.y = 126;
            };

            const ensureSpace = (requiredHeight: number) => {
                if (doc.y + requiredHeight <= doc.page.height - 60) return;
                doc.addPage();
                drawHeader();
            };

            const drawInfoRow = (label: string, value: string) => {
                ensureSpace(22);
                doc.font(fontPath).fontSize(11).fillColor(colors.muted).text(label, left, doc.y, { continued: true });
                doc.font(fontPath).fontSize(12).fillColor(colors.text).text(` ${value}`);
                doc.moveDown(0.25);
            };

            const drawListSection = (title: string, items: string[]) => {
                const normalized = items.filter((item) => item.trim());
                ensureSpace(34);
                doc.moveDown(0.35);
                doc.font(fontPath).fontSize(15).fillColor(colors.text).text(title, left, doc.y, { width });
                doc.moveDown(0.25);

                if (!normalized.length) {
                    doc.font(fontPath).fontSize(11).fillColor(colors.muted).text('Не вказано', left, doc.y, { width });
                    doc.moveDown(0.6);
                    return;
                }

                normalized.forEach((item, index) => {
                    const itemText = `${index + 1}. ${item}`;
                    const itemHeight = doc.heightOfString(itemText, { width, lineGap: 3 });
                    ensureSpace(itemHeight + 8);
                    doc.font(fontPath).fontSize(11).fillColor(colors.text).text(itemText, left, doc.y, {
                        width,
                        lineGap: 3,
                    });
                    doc.moveDown(0.2);
                });

                doc.moveDown(0.4);
            };

            drawHeader();

            drawInfoRow('Пацієнт:', patientName);
            drawInfoRow('Спеціаліст:', doctorName);
            drawInfoRow('Дата візиту:', this.formatDateTimeUa(appointmentDate));

            ensureSpace(80);
            doc.moveDown(0.4);
            doc.font(fontPath).fontSize(15).fillColor(colors.text).text('Консультативний висновок', left, doc.y, { width });
            doc.moveDown(0.25);
            doc.font(fontPath).fontSize(11).fillColor(colors.text).text(conclusion || 'Не вказано', left, doc.y, {
                width,
                lineGap: 4,
            });
            doc.moveDown(0.7);

            drawListSection('План лікування', treatmentPlanItems);
            drawListSection('Рекомендації', recommendationItems);
            drawListSection('Призначені ліки', medicationItems);

            ensureSpace(60);
            if (nextVisitDate) {
                doc.font(fontPath).fontSize(12).fillColor(colors.text).text(
                    `Рекомендована дата наступного візиту: ${this.formatDateOnlyUa(nextVisitDate)}`,
                    left,
                    doc.y,
                    { width },
                );
                doc.moveDown(0.8);
            }

            doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).stroke(colors.line);
            doc.moveDown(0.7);
            doc.font(fontPath).fontSize(11).fillColor(colors.muted).text('Документ сформовано автоматично в системі ORADENT.', left, doc.y, {
                width,
                align: 'left',
            });

            doc.end();
        });
    }

    async sendDoctorScheduledVisitEmail(params: {
        to: string;
        patientName: string;
        appointmentLine: string;
    }) {
        const { to, patientName, appointmentLine } = params;

        const pdfBuffer = await this.buildAppointmentNoticePdfBuffer({
            title: 'ПІДТВЕРДЖЕННЯ ЗАПИСУ',
            patientName,
            summary: 'Лікар або адміністратор створив для вас запис без онлайн-оплати.',
            appointmentLines: [appointmentLine],
            footerNote: 'За деталями зверніться до клініки.',
        });

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'ORADENT — вас записано на прийом',
            html: this.buildEmailShell(
                'ПІДТВЕРДЖЕННЯ ЗАПИСУ',
                `
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#111111;">Добрий день, <strong>${this.escapeHtml(patientName)}</strong>.</p>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#111111;">Для вас створено новий запис на прийом. PDF-файл з деталями прикріплено до листа.</p>
                    <div style="margin:0 0 18px;padding:18px;border:1.5px solid #111111;background:#ffffff;">
                        <div style="margin:0 0 8px;font-size:15px;font-weight:700;color:#111111;">Деталі запису:</div>
                        <div style="font-size:14px;line-height:1.7;color:#111111;">${this.escapeHtml(appointmentLine)}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;text-align:center;">Онлайн-оплата для цього запису не потрібна.</p>
                `,
            ),
            attachments: [
                {
                    filename: 'appointment-confirmation.pdf',
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
    }

    async sendAppointmentCancelledEmail(params: {
        to: string;
        patientName: string;
        appointmentLine: string;
        reason?: string;
    }) {
        const { to, patientName, appointmentLine, reason } = params;
        const pdfBuffer = await this.buildAppointmentNoticePdfBuffer({
            title: 'СКАСУВАННЯ ЗАПИСУ',
            patientName,
            summary: reason ? `Запис було скасовано. Причина: ${reason}` : 'Запис було скасовано адміністрацією клініки.',
            appointmentLines: [appointmentLine],
            footerNote: 'За потреби зверніться до клініки для повторного запису.',
        });

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'ORADENT — запис скасовано',
            html: this.buildEmailShell(
                'СКАСУВАННЯ ЗАПИСУ',
                `
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#111111;">Добрий день, <strong>${this.escapeHtml(patientName)}</strong>.</p>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#111111;">Ваш запис було скасовано. PDF-файл з деталями прикріплено до листа.</p>
                    <div style="margin:0 0 18px;padding:18px;border:1.5px solid #111111;background:#ffffff;">
                        <div style="margin:0 0 8px;font-size:15px;font-weight:700;color:#111111;">Скасований запис:</div>
                        <div style="font-size:14px;line-height:1.7;color:#111111;">${this.escapeHtml(appointmentLine)}</div>
                        ${reason ? `<div style="margin-top:10px;font-size:13px;line-height:1.7;color:#6b7280;">Причина: ${this.escapeHtml(reason)}</div>` : ''}
                    </div>
                `,
            ),
            attachments: [
                {
                    filename: 'appointment-cancelled.pdf',
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
    }

    async sendAppointmentRescheduledEmail(params: {
        to: string;
        patientName: string;
        previousAppointmentLine: string;
        nextAppointmentLine: string;
    }) {
        const { to, patientName, previousAppointmentLine, nextAppointmentLine } = params;
        const pdfBuffer = await this.buildAppointmentNoticePdfBuffer({
            title: 'ПЕРЕНЕСЕННЯ ЗАПИСУ',
            patientName,
            summary: 'Ваш запис було перенесено. Нові деталі наведено нижче.',
            appointmentLines: [
                `Було: ${previousAppointmentLine}`,
                `Стало: ${nextAppointmentLine}`,
            ],
            footerNote: 'Будь ласка, перевірте нову дату та час візиту.',
        });

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'ORADENT — запис перенесено',
            html: this.buildEmailShell(
                'ПЕРЕНЕСЕННЯ ЗАПИСУ',
                `
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#111111;">Добрий день, <strong>${this.escapeHtml(patientName)}</strong>.</p>
                    <div style="margin:0 0 18px;padding:18px;border:1.5px solid #111111;background:#ffffff;">
                        <div style="margin:0 0 8px;font-size:15px;font-weight:700;color:#111111;">Було:</div>
                        <div style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#111111;">${this.escapeHtml(previousAppointmentLine)}</div>
                        <div style="margin:0 0 8px;font-size:15px;font-weight:700;color:#111111;">Стало:</div>
                        <div style="font-size:14px;line-height:1.7;color:#111111;">${this.escapeHtml(nextAppointmentLine)}</div>
                    </div>
                `,
            ),
            attachments: [
                {
                    filename: 'appointment-rescheduled.pdf',
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
    }

    async sendAppointmentNoShowEmail(params: {
        to: string;
        patientName: string;
        appointmentLine: string;
    }) {
        const { to, patientName, appointmentLine } = params;
        const pdfBuffer = await this.buildAppointmentNoticePdfBuffer({
            title: 'ПРИЙОМ НЕ ВІДБУВСЯ',
            patientName,
            summary: 'Адміністратор позначив, що пацієнт не з’явився на прийом.',
            appointmentLines: [appointmentLine],
            footerNote: 'За потреби ви можете записатися повторно.',
        });

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'ORADENT — запис позначено як неявка',
            html: this.buildEmailShell(
                'ПРИЙОМ НЕ ВІДБУВСЯ',
                `
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#111111;">Добрий день, <strong>${this.escapeHtml(patientName)}</strong>.</p>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#111111;">Запис було позначено як неявка</p>
                    <div style="margin:0 0 18px;padding:18px;border:1.5px solid #111111;background:#ffffff;">
                        <div style="margin:0 0 8px;font-size:15px;font-weight:700;color:#111111;">Деталі запису:</div>
                        <div style="font-size:14px;line-height:1.7;color:#111111;">${this.escapeHtml(appointmentLine)}</div>
                    </div>
                `,
            ),
            attachments: [
                {
                    filename: 'appointment-no-show.pdf',
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
    }


    async sendConsultationConclusionEmail(params: {
        to: string;
        patientName: string;
        doctorName: string;
        appointmentDate: Date | string | null;
        conclusion: string;
        treatmentPlanItems: string[];
        recommendationItems: string[];
        medicationItems: string[];
        nextVisitDate?: Date | string | null;
        reviewLink?: string;
    }) {
        const {
            to,
            patientName,
            doctorName,
            appointmentDate,
            conclusion,
            treatmentPlanItems,
            recommendationItems,
            medicationItems,
            nextVisitDate,
            reviewLink,
        } = params;

        const pdfBuffer = await this.buildConsultationPdfBuffer({
            patientName,
            doctorName,
            appointmentDate,
            conclusion,
            treatmentPlanItems,
            recommendationItems,
            medicationItems,
            nextVisitDate,
        });

        await this.transporter.sendMail({
            from: this.configService.get('MAIL_FROM'),
            to,
            subject: 'ORADENT — консультативний висновок',
            html: this.buildEmailShell(
                'КОНСУЛЬТАТИВНИЙ ВИСНОВОК',
                `
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#111111;">Добрий день, <strong>${this.escapeHtml(patientName)}</strong>.</p>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#111111;">До листа прикріплено PDF-файл з висновком лікаря, планом лікування, рекомендаціями та призначеними ліками.</p>
                    <p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#6b7280;text-align:center;">Лікар: ${this.escapeHtml(doctorName)} · Дата візиту: ${this.escapeHtml(this.formatDateTimeUa(appointmentDate))}</p>
                    ${reviewLink ? `
                        <div style="text-align:center;margin-top:12px;">
                            <a href="${this.escapeHtml(reviewLink)}" style="display:inline-block;padding:12px 18px;border:1.5px solid #111111;background:#84d8ce;color:#111111;text-decoration:none;font-size:13px;font-weight:700;text-transform:uppercase;">Залишити відгук</a>
                        </div>
                    ` : ''}
                `,
            ),
            attachments: [
                {
                    filename: 'consultation-conclusion.pdf',
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });
    }


}