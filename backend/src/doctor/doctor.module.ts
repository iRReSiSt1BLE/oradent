import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doctor } from './entities/doctor.entity';
import { DoctorController } from './doctor.controller';
import { DoctorService } from './doctor.service';
import { UserModule } from '../user/user.module';
import { VerificationModule } from '../verification/verification.module';
import { MailModule } from '../mail/mail.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';
import { PatientModule } from '../patient/patient.module';
import { AdminModule } from '../admin/admin.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Doctor]),
        UserModule,
        VerificationModule,
        MailModule,
        PhoneVerificationModule,
        PatientModule,
        AdminModule,
    ],
    controllers: [DoctorController],
    providers: [DoctorService],
    exports: [DoctorService],
})
export class DoctorModule {}
