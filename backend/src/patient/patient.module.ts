import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from './entities/patient.entity';
import { PatientService } from './patient.service';
import { PatientController } from './patient.controller';
import { UserModule } from '../user/user.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Patient]),
        UserModule,
        PhoneVerificationModule,
    ],
    providers: [PatientService],
    controllers: [PatientController],
    exports: [PatientService],
})
export class PatientModule {}