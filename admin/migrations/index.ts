import * as migration_20261016_085933_initial from './20261016_085933_initial';
import * as migration_20261016_155309_publish_queue_cas from './20261016_155309_publish_queue_cas';
import * as migration_20261016_160826_publish_snapshot from './20261016_160826_publish_snapshot';
import * as migration_20261016_162202_reel_heartbeat from './20261016_162202_reel_heartbeat';

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
    name: '20261016_162202_reel_heartbeat'
  },
];
