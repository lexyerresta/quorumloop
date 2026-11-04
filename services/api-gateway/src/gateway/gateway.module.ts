import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { ForgeController, ProjectSyncController } from './forge.controller';
import { GatewayProxy } from './gateway-proxy';
import { GovernanceController } from './governance.controller';
import { InstanceAggregator } from './instance-aggregator.service';
import { NotificationsController } from './notifications.controller';
import { OverviewController } from './overview.controller';
import { ProjectsController } from './projects.controller';
import { RuntimeController } from './runtime.controller';
import { CsrfGuard, SessionGuard } from './session.guard';
import { TasksController } from './tasks.controller';
import { WebhooksController } from './webhooks.controller';

/**
 * The public boundary. Guards are global and ordered: the session guard resolves the cookie into
 * an identity, then the CSRF guard checks unsafe methods against that identity. Every controller
 * below only forwards — no business rule lives in the gateway.
 */
@Module({
  controllers: [
    OverviewController,
    AuthController,
    ProjectsController,
    TasksController,
    RuntimeController,
    ForgeController,
    ProjectSyncController,
    GovernanceController,
    NotificationsController,
    WebhooksController,
  ],
  providers: [
    GatewayProxy,
    InstanceAggregator,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class GatewayModule {}
