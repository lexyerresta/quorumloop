import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'quality-service', module: AppModule }).catch((error: unknown) => {
  process.stderr.write(`quality-service failed to start: ${String(error)}\n`);
  process.exit(1);
});
