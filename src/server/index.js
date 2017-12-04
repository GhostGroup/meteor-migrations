import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';
import { isFunction } from './utils';
import Log from './logger';

const defaultMigration = {
  version: 0,
  name: 'zero',
  up(){},
};

const Migrations = {
  _migrations: {
    0: { ...defaultMigration },
    zero: { ...defaultMigration },
  },
  _collection: null,
  _commands: {
    LATEST: this.migrateAll,
    ALL: this.migrateAll,
    ONE: this.migrateOne,
    UPTO: this.migrateTo,
    REVERT: this.revertAll,
    REVERTALL: this.revertAll,
    REVERTTO: this.revertTo,
    REVERTONE: this.revertOne,
    UNLOCK: this.unlock,
  },

  _config: {
    log: true,
    logger({ level, message, tag }) {
      if (this.log) {
        const fn = Log[level] || Log._;
        fn(message, tag, Meteor.userId());
      }
    },
    collectionName: 'migrations',
    migrateOnStartup: false,
    migrateToVersion: 'latest',
  },

  log(data){
    this._config.logger(data);
  },

  config(options) {
    this._config = {
      ...this._config,
      ...options
    };
  },

  setCurrentVersion(migration) {
    this._collection.update({
      _id: 'control',
    }, {$set: {
      current: {
        migration,
        version: migration.version,
        name: migration.name,
      },
    }});
  },

  getCurrentVersion() {
    return this._collection.findOne({ _id: 'control' }).current;
  },

  init() {
    this._collection = new Mongo.Collection(this._config.collectionName);
    this._collection.update({
      _id: 'control',
    }, {$set: {
      current: {
        migration: defaultMigration,
        version: defaultMigration.version,
        name: defaultMigration.name,
      },
      locked: false,
      lastUpdate: new Date(),
    }}, {
      upsert: true,
    });
  },

  getControl() {
    return this._collection.findOne({ _id: 'control' });
  },

  exists(versionOrName) {
    if (!this._migrations[versionOrName]) {
      throw Meteor.Error(`Sorry, migration ${versionOrName} does not exist.`);
    }

    return this._migrations[versionOrName];
  },

  lock() {
    return (this._collection.update({
      _id: 'control',
      locked: false,
    }, {$set: {
      locked: true,
      lastUpdate: new Date(),
    }})) === 1;
  },

  unlock() {
    return (this._collection.update({
      _id: 'control',
      locked: true,
    }, {$set: {
      locked: false,
      lastUpdate: new Date(),
    }})) === 1;
  },

  isLocked() {
    if (this.getControl().locked) {
      const message = 'Not migrating, control is locked.';
      this.log({
        level: 'error',
        message,
        tag: 'ERROR',
      });
      throw Meteor.Error(message);
    }
  },

  reset() {
    this._migrations = {};
    this._collection.remove({});
  },

  sortedMigrations(reverse = false) {
    let keys = Object.keys(this._migrations);
    if (reverse) {
      keys.reverse();
    } else {
      keys.sort();
    }

    return keys
      .map(version => this._migrations[version])
      .filter(el => Match.test(el, Match.Integer));
  },

  add(migration) {
    const {
      version,
      name,
      description,
      up,
      down,
      dependencies = [],
    } = migration;

    check(version, Match.Integer);
    if (!isFunction(up)) {
      throw new Meteor.Error('You must specify both a version and an UP function.');
    }

    if (this._actions[version]) {
      throw new Meteor.Error(`This migration version already exists: [${version}] ${this._actions[version].name} => ${this._actions[version].description}`);
    }
    if (this._actions[name]) {
      throw new Meteor.Error(`This migration name already exists: [${version}] ${this._actions[version].name} => ${this._actions[version].description}`);
    }

    const safeMigration = Object.freeze({ ...migration });
    this._migrations[version] = safeMigration;
    if (name) {
      this._migrations[name] = this._actions[version];
    }

    this.log({ message: `added migration ${version} ${name}` });
  },

  migrateAll () {
    this.isLocked();

    const current = this.getCurrentVersion();
    const migrations = this.sortedMigrations();

    if (current.version >= migrations[migrations.length - 1].version) {
      this.log({ message: `Migrations at latest version: ${current.version} ${current.name}` });
      return;
    }

    this.lock();
    this.sortedMigrations().forEach(migration => {
      try {
        this.log({ message: `migrating to version: ${migration.version} ${migration.name}` });
        migration.up();
        this.setCurrentVersion(migration);
      } catch (e) {
        this._config.logger({
          level: 'error',
          message: e,
          tag: 'ERROR',
        });
      }
    });

    this.unlock();
  },

  migrateTo (versionOrName) {
    this.isLocked();

    if (versionOrName === 'latest') {
      return this.migrateAll();
    }

    const checkMigration = this.exists(versionOrName);
    const current = this.getCurrentVersion();
    if (current.version > checkMigration.version) {
      this.log({ message: `Migrations are currently at a higher version ${current.version} ${current.name}. Not migrating to ${checkMigration.version} ${checkMigration.name}` });
      return;
    }

    if (current.version === checkMigration.version) {
      this.log({ message: `Migrations are already at ${checkMigration.version} ${checkMigration.name}. Not migrating.` });
      return;
    }

    this.lock();
    this.sortedMigrations().some(migration => {
      try {
        this.log({ message: `migrating to version: ${migration.version} ${migration.name}` });
        migration.up();
        this.setCurrentVersion(migration);
      } catch (e) {
        this._config.logger({
          level: 'error',
          message: e,
          tag: 'ERROR',
        });
      }

      return migration.version === versionOrName || migration.name === versionOrName;
    });
    this.unlock();
  },

  migrateOne (versionOrName) {
    this.isLocked();

    const current = this.getCurrentVersion();
    const migration = this.exists(versionOrName);
    const depVersions = migration.dependencies.map(dep => dep.version);
    depVersions.sort();
    depVersions.forEach(version => this.migrateOne(version));

    if (current.version === migration.version) {
      this.log({ message: `Migrations already at ${migration.version} ${migration.name}. Not migrating.`});
      return;
    }

    this.lock();
    try {
      this.log({ message: `migrating to version: ${migration.version} ${migration.name}` });
      migration.up();
      this.setCurrentVersion(migration);
    } catch (e) {
      this._config.logger({
        level: 'error',
        message: e,
        tag: 'ERROR',
      });
    }
    this.unlock();
  },

  revertAll () {
    this.isLocked();

    const current = this.getCurrentVersion();
    if (current.version === defaultMigration.version) {
      this.log({ message: `No migrations to revert.`});
      return;
    }

    this.lock();
    this.sortedMigrations(true).forEach(migration => {
      if (isFunction(migration.down)) {
        try {
          this.log({ message: `reverting version: ${migration.version} ${migration.name}` });
          migration.down();
          this.setCurrentVersion(migration);
        } catch (e) {
          this._config.logger({
            level: 'error',
            message: e,
            tag: 'ERROR',
          });
        }
      }
    });
    this.unlock();
  },

  revertTo (versionOrName) {
    this.isLocked();

    const checkMigration = this.exists(versionOrName);
    const current = this.getCurrentVersion();
    if (current.version < checkMigration.version) {
      this.log({ message: `Migrations are currently at a lower version ${current.version} ${current.name}. Not migrating to ${checkMigration.version} ${checkMigration.name}` });
      return;
    }

    if (current.version === checkMigration.version) {
      this.log({ message: `Migrations are already at ${checkMigration.version} ${checkMigration.name}. Not migrating.` });
      return;
    }

    this.lock();
    this.sortedMigrations(true).some(migration => {
      if (isFunction(migration.down)) {
        try {
          this.log({ message: `reverting version: ${migration.version} ${migration.name}` });
          migration.down();
          this.setCurrentVersion(migration);
        } catch (e) {
          this._config.logger({
            level: 'error',
            message: e,
            tag: 'ERROR',
          });
        }
      }

      return migration.version === versionOrName || migration.name === versionOrName;
    });

    this.unlock();
  },

  revertOne (versionOrName) {
    this.isLocked();

    const migration = this.exists(versionOrName);
    const current = this.getCurrentVersion();
    if (current.version === migration.version) {
      this.log({ message: `Migrations already at ${migration.version} ${migration.name}. Not migrating.`});
      return;
    }

    if (isFunction(migration.down)) {
      this.lock();
      try {
        this.log({ message: `reverting version: ${migration.version} ${migration.name}` });
        migration.down();
        this.setCurrentVersion(migration);
      } catch (e) {
        this._config.logger({
          level: 'error',
          message: e,
          tag: 'ERROR',
        });
      }
      this.unlock();
    }
  },
};

Meteor.startup(() => {
  Migrations.init();

  if (process.env.MIGRATE_ON_STARTUP) {
    const [command, versionOrName] = MIGRATE_ON_STARTUP.split('|');
    if (Migrations._commands[command]) {
      Migrations._commands[command](versionOrName);
    }
  } else if (Migrations._config.migrateOnStartup) {
    Migrations.migrateTo(Migrations._config.migrateToVersion);
  }

  if (process.argv.includes('--once')) {
    process.exit(0);
  }
});


export default Migrations;
