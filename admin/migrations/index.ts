import * as migration_20261016_085933_initial from './20261016_085933_initial';

export const migrations = [
  {
    up: migration_20261016_085933_initial.up,
    down: migration_20261016_085933_initial.down,
    name: '20261016_085933_initial'
  },
];
