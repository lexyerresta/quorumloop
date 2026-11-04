import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'settings-service', module: AppModule }).catch((error: unknown) => {
  process.stderr.write(`settings-service failed to start: ${String(error)}\n`);
  process.exit(1);
});
