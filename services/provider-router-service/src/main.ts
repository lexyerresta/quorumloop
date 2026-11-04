import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'provider-router-service', module: AppModule }).catch(
  (error: unknown) => {
    process.stderr.write(`provider-router-service failed to start: ${String(error)}\n`);
    process.exit(1);
  },
);
