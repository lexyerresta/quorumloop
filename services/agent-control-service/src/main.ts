import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'agent-control-service', module: AppModule }).catch(
  (error: unknown) => {
    process.stderr.write(`agent-control-service failed to start: ${String(error)}\n`);
    process.exit(1);
  },
);
