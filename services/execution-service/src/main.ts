import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'execution-service', module: AppModule }).catch((error: unknown) => {
  process.stderr.write(`execution-service failed to start: ${String(error)}\n`);
  process.exit(1);
});
