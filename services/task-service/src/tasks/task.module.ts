import { Module } from '@nestjs/common';
import { ProjectDirectory } from './project-directory';
import { TaskController } from './task.controller';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

@Module({
  controllers: [TaskController],
  providers: [TaskRepository, TaskService, ProjectDirectory],
  exports: [TaskService],
})
export class TaskModule {}
