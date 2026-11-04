import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'workspace-service', module: AppModule }).catch((error: unknown) => {
  process.stderr.write(`workspace-service failed to start: ${String(error)}\n`);
  process.exit(1);
});
