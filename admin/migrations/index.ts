import * as migration_20261016_085933_initial from './20261016_085933_initial';
import * as migration_20261016_155309_publish_queue_cas from './20261016_155309_publish_queue_cas';

export const migrations = [
  {
    up: migration_20261016_085933_initial.up,
    down: migration_20261016_085933_initial.down,
    name: '20261016_085933_initial',
  },
  {
    up: migration_20261016_155309_publish_queue_cas.up,
    down: migration_20261016_155309_publish_queue_cas.down,
    name: '20261016_155309_publish_queue_cas'
  },
];
