import {BadRequestException, Injectable} from '@nestjs/common';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {Patient} from "./entities/patient.entity";
import {Repository} from "typeorm";
import {async} from "rxjs";

@Injectable()
export class PatientService {
    constructor(
        @InjectRepository(Patient) private readonly patientRepository: Repository<Patient>,
    ) {
    }


  async create(createPatientDto: CreatePatientDto) {
        const isUserExist = await this.patientRepository.findOne({
            where: {
                phoneNumber: createPatientDto.phoneNumber
            },
        })
        if(isUserExist) throw new BadRequestException('Patient with this phone number already exists!')

        const user = await this.patientRepository.save({
            ...createPatientDto,
            })


    return { user };
  }


  async findOne(phoneNumber: string): Promise<Patient | null> {
    return await this.patientRepository.findOne({where: {
        phoneNumber: phoneNumber
        }
    });
  }




  remove(id: number) {
    return `This action removes a #${id} patient`;
  }
}
