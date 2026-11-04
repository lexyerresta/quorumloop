import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'source-control-service', module: AppModule }).catch(
  (error: unknown) => {
    process.stderr.write(`source-control-service failed to start: ${String(error)}\n`);
    process.exit(1);
  },
);
