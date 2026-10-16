import * as migration_20261016_083317_initial from './20261016_083317_initial';

export const migrations = [
  {
    up: migration_20261016_083317_initial.up,
    down: migration_20261016_083317_initial.down,
    name: '20261016_083317_initial'
  },
];
