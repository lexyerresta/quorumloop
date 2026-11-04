import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'audit-service', module: AppModule }).catch((error: unknown) => {
  process.stderr.write(`audit-service failed to start: ${String(error)}\n`);
  process.exit(1);
});
