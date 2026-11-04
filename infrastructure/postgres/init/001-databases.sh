#!/bin/sh
# Creates one role and one database per owning service. The list mirrors
# packages/config/src/index.ts; a new service needs an entry here before it can boot.
set -eu

SERVICE_PASSWORD="${POSTGRES_SERVICE_PASSWORD:?POSTGRES_SERVICE_PASSWORD must be set}"

DATABASES="
quorumloop_identity
quorumloop_project
quorumloop_settings
quorumloop_notification
quorumloop_source_control
quorumloop_webhook
quorumloop_workspace
quorumloop_agent_control
quorumloop_provider_registry
quorumloop_provider_router
quorumloop_orchestration
quorumloop_execution
quorumloop_product_planning
quorumloop_scheduler
quorumloop_task
quorumloop_quality
quorumloop_activity
quorumloop_usage
quorumloop_audit
"

for database in $DATABASES; do
  psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<SQL
    do \$\$
    begin
      if not exists (select from pg_roles where rolname = '${database}') then
        create role ${database} with login password '${SERVICE_PASSWORD}';
      end if;
    end
    \$\$;
SQL
  if ! psql --username "$POSTGRES_USER" --dbname postgres -tAc "select 1 from pg_database where datname = '${database}'" | grep -q 1; then
    createdb --username "$POSTGRES_USER" --owner "$database" "$database"
  fi
  psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
    -c "revoke all on database ${database} from public" \
    -c "grant all privileges on database ${database} to ${database}" >/dev/null
done

# No role may create other roles or reach a database it does not own.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
  alter default privileges revoke all on tables from public;
SQL

echo "quorumloop databases ready"
