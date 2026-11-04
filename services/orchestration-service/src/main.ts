import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'orchestration-service', module: AppModule }).catch(
  (error: unknown) => {
    process.stderr.write(`orchestration-service failed to start: ${String(error)}\n`);
    process.exit(1);
  },
);
