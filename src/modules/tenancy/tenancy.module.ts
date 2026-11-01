import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({ providers: [MembersService], controllers: [MembersController] })
export class TenancyModule {}
