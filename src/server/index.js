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

export const Migrations = {
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
        const fn = level ? level.toLowerCase() : 'info';
        Log[fn](message, tag);
      }
    },
    collectionName: 'migrations',
    migrateOnStartup: false,
    migrateToVersion: 'latest',
  },

  init(forceUnlock = false) {
    this._collection = this._collection || new Mongo.Collection(this._config.collectionName);
    if (!this._collection.findOne({ _id: 'control' })) {
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
    }

    if (forceUnlock) {
      this.unlock();
    }
  },

  __nuke__() {
    this._collection.rawCollection().drop();
  },

  reset() {
    this._migrations = {};
    this._collection.remove({});
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
    return this._collection.update({
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
    this.log({
      level: 'WARN',
      message: 'locking migrations',
    });

    return (this._collection.update({
      _id: 'control',
      locked: false,
    }, {$set: {
      locked: true,
      lastUpdate: new Date(),
    }})) === 1;
  },

  unlock() {
    this.log({
      level: 'WARN',
      message: 'unlocking migrations',
    });

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
        level: 'ERROR',
        message,
        tag: 'ERROR',
      });
      throw Meteor.Error(message);
    }
  },

  currentVersionIsEqual(migration) {
    const current = this.getCurrentVersion();
    return Number(current.version) === Number(migration.version);
  },

  currentVersionIsAbove(migration) {
    const current = this.getCurrentVersion();
    return Number(current.version) > Number(migration.version);
  },

  currentVersionIsBelow(migration) {
    const current = this.getCurrentVersion();
    return Number(current.version) < Number(migration.version);
  },

  sortedMigrations(reverse = false) {
    let keys = Object.keys(this._migrations);
    if (reverse) {
      keys.reverse();
    } else {
      keys.sort();
    }

    return keys
      .map(version => !isNaN(Number(version)) ? this._migrations[version] : null)
      .filter(el => !!el);
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

    if (!isFunction(up)) {
      throw new Meteor.Error('You must specify both a version and an UP function.');
    }

    if (this._migrations[version]) {
      throw new Meteor.Error(`This migration version already exists: [${version}] ${this._migrations[version].name} => ${this._migrations[version].description}`);
    }
    if (this._migrations[name]) {
      throw new Meteor.Error(`This migration name already exists: [${version}] ${this._migrations[version].name} => ${this._migrations[version].description}`);
    }

    const safeMigration = Object.freeze({
      version,
      name,
      description,
      up,
      down,
      dependencies,
    });
    this._migrations[version] = safeMigration;
    if (name) {
      this._migrations[name] = this._migrations[version];
    }

    this.log({ message: `added migration ${version} ${name}` });
  },

  migrateAll (force = false) {
    this.isLocked();

    const migrations = this.sortedMigrations();
    if (!force) {
      const current = this.getCurrentVersion();
      const latest = migrations.pop();
      if (this.currentVersionIsEqual(latest) || this.currentVersionIsAbove(latest)) {
        this.log({ message: `Migrations already at latest version: ${current.version} ${current.name}` });
        return;
      }
      migrations.push(latest);
    }

    this.lock();
    this.sortedMigrations().forEach(migration => {
      try {
        this.log({ message: `migrating to version: ${migration.version} ${migration.name}` });
        const response = migration.up();
        this.log({
          level: 'LOG',
          message: response,
          tag: `${migration.version} [${migration.name}]: ${migration.description}`,
        });
        this.setCurrentVersion(migration);
      } catch (e) {
        this.log({
          level: 'ERROR',
          message: e,
          tag: 'ERROR',
        });
      }
    });

    this.unlock();
  },

  migrateTo (versionOrName, force = false) {
    this.isLocked();

    if (versionOrName === 'latest') {
      return this.migrateAll(force);
    }

    const checkMigration = this.exists(versionOrName);
    if (!force) {
      const current = this.getCurrentVersion();
      if (this.currentVersionIsAbove(checkMigration)) {
        this.log({
          level: 'DEBUG',
          message: `Migrations are currently at a higher version ${current.version} ${current.name}. Not migrating to ${checkMigration.version} ${checkMigration.name}`,
        });
        return;
      }

      if (this.currentVersionIsEqual(checkMigration)) {
        this.log({
          level: 'DEBUG',
          message: `Migrations are already at ${checkMigration.version} ${checkMigration.name}. Not migrating.`,
        });
        return;
      }
    }

    this.lock();
    this.sortedMigrations().some(migration => {
      try {
        this.log({
          level: 'TRACE',
          message: `migrating to version: ${migration.version} ${migration.name}`,
        });
        const response = migration.up();
        this.log({
          level: 'LOG',
          message: response,
          tag: `${migration.version} [${migration.name}]: ${migration.description}`,
        });
        this.setCurrentVersion(migration);
      } catch (e) {
        this.log({
          level: 'ERROR',
          message: e,
          tag: 'ERROR',
        });
      }

      return migration.version === versionOrName || migration.name === versionOrName;
    });
    this.unlock();
  },

  migrateOne (versionOrName, force = false) {
    this.isLocked();

    const migration = this.exists(versionOrName);
    if (!force) {
      const current = this.getCurrentVersion();
      if (this.currentVersionIsEqual(migration)) {
        this.log({
          level: 'DEBUG',
          message: `Migrations already at ${migration.version} ${migration.name}. Not migrating.`,
        });
        return;
      }
    }

    const depVersions = migration.dependencies.map(dep => dep.version);
    depVersions.sort();
    depVersions.forEach(version => this.migrateOne(version, force));

    this.lock();
    try {
      this.log({
        level: 'DEBUG',
        message: `migrating to version: ${migration.version} ${migration.name}`,
      });
      const response = migration.up();
      this.log({
        level: 'LOG',
        message: response,
        tag: `${migration.version} [${migration.name}]: ${migration.description}`,
      });
    this.setCurrentVersion(migration);
    } catch (e) {
      this.log({
        level: 'ERROR',
        message: e,
        tag: 'ERROR',
      });
    }
    this.unlock();
  },

  revertAll (force = false) {
    this.isLocked();

    if (!force) {
      const current = this.getCurrentVersion();
      if (this.currentVersionIsEqual(defaultMigration)) {
        this.log({
          level: 'DEBUG',
          message: `No migrations to revert.`,
        });
        return;
      }
    }

    this.lock();
    this.sortedMigrations(true).forEach(migration => {
      if (isFunction(migration.down)) {
        try {
          this.log({
            level: 'DEBUG',
            message: `reverting version: ${migration.version} ${migration.name}`,
          });
          const response = migration.down();
          this.log({
            level: 'LOG',
            message: response,
            tag: `${migration.version} [${migration.name}]: ${migration.description}`,
          });
            this.setCurrentVersion(migration);
        } catch (e) {
          this.log({
            level: 'ERROR',
            message: e,
            tag: 'ERROR',
          });
        }
      }
    });
    this.unlock();
  },

  revertTo (versionOrName, force = false) {
    this.isLocked();

    const checkMigration = this.exists(versionOrName);
    if (!force) {
      if (this.currentVersionIsBelow(checkMigration)) {
        this.log({
          level: 'DEBUG',
          message: `Migrations are currently at a lower version ${current.version} ${current.name}. Not migrating to ${checkMigration.version} ${checkMigration.name}`,
        });
        return;
      }

      if (this.currentVersionIsEqual(checkMigration)) {
        this.log({
          level: 'DEBUG',
          message: `Migrations are already at ${checkMigration.version} ${checkMigration.name}. Not migrating.`,
        });
        return;
      }
    }

    this.lock();
    this.sortedMigrations(true).some(migration => {
      if (isFunction(migration.down)) {
        try {
          this.log({
            level: 'DEBUG',
            message: `reverting version: ${migration.version} ${migration.name}`,
          });
          const response = migration.down();
          this.log({
            level: 'LOG',
            message: response,
            tag: `${migration.version} [${migration.name}]: ${migration.description}`,
          });
            this.setCurrentVersion(migration);
        } catch (e) {
          this.log({
            level: 'ERROR',
            message: e,
            tag: 'ERROR',
          });
        }
      }

      return Number(migration.version) === Number(versionOrName) || migration.name === versionOrName;
    });

    this.unlock();
  },

  revertOne (versionOrName, force = false) {
    this.isLocked();

    const migration = this.exists(versionOrName);
    if (!force) {
      if (this.currentVersionIsEqual(migration)) {
        this.log({
          level: 'DEBUG',
          message: `Migrations already at ${migration.version} ${migration.name}. Not migrating.`,
        });
        return;
      }
    }

    if (isFunction(migration.down)) {
      this.lock();
      try {
        this.log({
          level: 'DEBUG',
          message: `reverting version: ${migration.version} ${migration.name}`,
        });
        const response = migration.down();
        this.log({
          level: 'LOG',
          message: response,
          tag: `${migration.version} [${migration.name}]: ${migration.description}`,
        });
        this.setCurrentVersion(migration);
      } catch (e) {
        this.log({
          level: 'ERROR',
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
