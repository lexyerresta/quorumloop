import { defineDatabaseModule, defineMessagingModule } from '@quorumloop/platform';
import { Module } from '@nestjs/common';
import { schema } from './database/schema';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [
    defineDatabaseModule({
      service: 'identity-service',
      database: 'quorumloop_identity',
      schema,
    }),
    defineMessagingModule({ service: 'identity-service' }),
    IdentityModule,
  ],
})
export class AppModule {}
