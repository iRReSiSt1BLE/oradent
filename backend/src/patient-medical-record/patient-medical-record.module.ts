import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatientMedicalRecord } from './entities/patient-medical-record.entity';

@Module({
    imports: [TypeOrmModule.forFeature([PatientMedicalRecord])],
    exports: [TypeOrmModule],
})
export class PatientMedicalRecordModule {}