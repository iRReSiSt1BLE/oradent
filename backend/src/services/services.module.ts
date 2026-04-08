import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClinicServiceEntity } from './entities/clinic-service.entity';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { ServiceCategoryEntity } from './entities/service-category.entity';
import { DoctorSpecialty } from '../doctor/entities/doctor-specialty.entity';
import { DoctorModule } from '../doctor/doctor.module';
import {Doctor} from "../doctor/entities/doctor.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ClinicServiceEntity,
            ServiceCategoryEntity,
            DoctorSpecialty,
            Doctor,
        ]),
        UserModule,
        AdminModule,
        DoctorModule,
    ],
    providers: [ServicesService],
    controllers: [ServicesController],
    exports: [ServicesService],
})
export class ServicesModule {}