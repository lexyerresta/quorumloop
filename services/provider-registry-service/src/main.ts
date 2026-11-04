import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'provider-registry-service', module: AppModule }).catch(
  (error: unknown) => {
    process.stderr.write(`provider-registry-service failed to start: ${String(error)}\n`);
    process.exit(1);
  },
);
