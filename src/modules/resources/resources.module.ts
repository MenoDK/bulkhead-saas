import { Module } from '@nestjs/common';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({ providers: [ResourcesService], controllers: [ResourcesController] })
export class ResourcesModule {}
