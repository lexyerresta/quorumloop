import { defineDatabaseModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { SettingsModule } from './settings/settings.module';

/**
 * Settings owns policy and its revision history, and nothing else. It publishes no events yet:
 * the only consumer of a policy change would be provider-router, which is still a scaffold, and an
 * event with no consumer is a contract nobody verifies.
 */
@Module({
  imports: [
    defineDatabaseModule({
      service: 'settings-service',
      database: 'quorumloop_settings',
      schema,
    }),
    SettingsModule,
  ],
})
export class AppModule {}
