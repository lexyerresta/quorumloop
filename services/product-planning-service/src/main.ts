import { startService } from '@quorumloop/platform';
import { AppModule } from './app.module';

void startService({ service: 'product-planning-service', module: AppModule }).catch(
  (error: unknown) => {
    process.stderr.write(`product-planning-service failed to start: ${String(error)}\n`);
    process.exit(1);
  },
);
