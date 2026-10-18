import * as migration_20261016_085933_initial from './20261016_085933_initial';
import * as migration_20261016_155309_publish_queue_cas from './20261016_155309_publish_queue_cas';
import * as migration_20261016_160826_publish_snapshot from './20261016_160826_publish_snapshot';
import * as migration_20261016_162202_reel_heartbeat from './20261016_162202_reel_heartbeat';
import * as migration_20261016_163754_tale_client_key from './20261016_163754_tale_client_key';
import * as migration_20261017_063303_redirect_status from './20261017_063303_redirect_status';
import * as migration_20261018_043903_route_activity_times from './20261018_043903_route_activity_times';
import * as migration_20261018_051824_tale_hero_route from './20261018_051824_tale_hero_route';

export const migrations = [
  {
    up: migration_20261016_085933_initial.up,
    down: migration_20261016_085933_initial.down,
    name: '20261016_085933_initial',
  },
  {
    up: migration_20261016_155309_publish_queue_cas.up,
    down: migration_20261016_155309_publish_queue_cas.down,
    name: '20261016_155309_publish_queue_cas',
  },
  {
    up: migration_20261016_160826_publish_snapshot.up,
    down: migration_20261016_160826_publish_snapshot.down,
    name: '20261016_160826_publish_snapshot',
  },
  {
    up: migration_20261016_162202_reel_heartbeat.up,
    down: migration_20261016_162202_reel_heartbeat.down,
    name: '20261016_162202_reel_heartbeat',
  },
  {
    up: migration_20261016_163754_tale_client_key.up,
    down: migration_20261016_163754_tale_client_key.down,
    name: '20261016_163754_tale_client_key',
  },
  {
    up: migration_20261017_063303_redirect_status.up,
    down: migration_20261017_063303_redirect_status.down,
    name: '20261017_063303_redirect_status',
  },
  {
    up: migration_20261018_043903_route_activity_times.up,
    down: migration_20261018_043903_route_activity_times.down,
    name: '20261018_043903_route_activity_times',
  },
  {
    up: migration_20261018_051824_tale_hero_route.up,
    down: migration_20261018_051824_tale_hero_route.down,
    name: '20261018_051824_tale_hero_route'
  },
];
