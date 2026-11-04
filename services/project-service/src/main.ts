import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'project-service', module: AppModule }).catch((error: unknown) => {
  process.stderr.write(`project-service failed to start: ${String(error)}\n`);
  process.exit(1);
});
