import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from './entities/admin.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule } from '@nestjs/config';
import { VerificationModule } from '../verification/verification.module';
import { MailModule } from '../mail/mail.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';
import { PatientModule } from '../patient/patient.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Admin]),
        UserModule,
        ConfigModule,
        VerificationModule,
        MailModule,
        PhoneVerificationModule,
        PatientModule,
    ],
    providers: [AdminService],
    controllers: [AdminController],
    exports: [AdminService],
})
export class AdminModule {}
