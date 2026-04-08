import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from './entities/patient.entity';
import { PatientService } from './patient.service';
import { PatientController } from './patient.controller';
import { UserModule } from '../user/user.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';
import {Appointment} from "../appointment/entities/appointment.entity";
import {PatientMedicalRecord} from "../patient-medical-record/entities/patient-medical-record.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Patient,
            Appointment,
            PatientMedicalRecord,
        ]),
        UserModule,
        PhoneVerificationModule,
    ],
    providers: [PatientService],
    controllers: [PatientController],
    exports: [PatientService],
})
export class PatientModule {}