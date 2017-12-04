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


/*
  Adds migration capabilities. Migrations are defined like:

  Migrations.add({
    up: function() {}, //*required* code to run to migrate upwards
    version: 1, //*required* number to identify migration order
    down: function() {}, //*optional* code to run to migrate downwards
    name: 'Something' //*optional* display name for the migration
  });

  The ordering of migrations is determined by the version you set.

  To run the migrations, set the MIGRATE environment variable to either
  'latest' or the version number you want to migrate to. Optionally, append
  ',exit' if you want the migrations to exit the meteor process, e.g if you're
  migrating from a script (remember to pass the --once parameter).

  e.g:
  MIGRATE="latest" mrt # ensure we'll be at the latest version and run the app
  MIGRATE="latest,exit" mrt --once # ensure we'll be at the latest version and exit
  MIGRATE="2,exit" mrt --once # migrate to version 2 and exit

  Note: Migrations will lock ensuring only 1 app can be migrating at once. If
  a migration crashes, the control record in the migrations collection will
  remain locked and at the version it was at previously, however the db could
  be in an inconsistant state.
*/

// since we'll be at version 0 by default, we should have a migration set for
// it.
var DefaultMigration = { version: 0, up: function() {} };

Migrations = {
  _list: [DefaultMigration],
  options: {
    // false disables logging
    log: true,
    // null or a function
    logger: null,
    // enable/disable info log "already at latest."
    logIfLatest: true,
    // migrations collection name
    collectionName: 'migrations',
  },
  config: function(opts) {
    this.options = _.extend({}, this.options, opts);
  },
};

/*
  Logger factory function. Takes a prefix string and options object
  and uses an injected `logger` if provided, else falls back to
  Meteor's `Log` package.
  Will send a log object to the injected logger, on the following form:
    message: String
    level: String (info, warn, error, debug)
    tag: 'Migrations'
*/
function createLogger(prefix) {
  check(prefix, String);

  // Return noop if logging is disabled.
  if (Migrations.options.log === false) {
    return function() {};
  }

  return function(level, message) {
    check(level, Match.OneOf('info', 'error', 'warn', 'debug'));
    check(message, String);

    var logger = Migrations.options && Migrations.options.logger;

    if (logger && _.isFunction(logger)) {
      logger({
        level: level,
        message: message,
        tag: prefix,
      });
    } else {
      Log[level]({ message: prefix + ': ' + message });
    }
  };
}

var log;

Meteor.startup(function() {
  var options = Migrations.options;

  // collection holding the control record
  Migrations._collection = new Mongo.Collection(options.collectionName);

  log = createLogger('Migrations');

  ['info', 'warn', 'error', 'debug'].forEach(function(level) {
    log[level] = _.partial(log, level);
  });

  if (process.env.MIGRATE) Migrations.migrateTo(process.env.MIGRATE);
});

// Add a new migration:
// {up: function *required
//  version: Number *required
//  down: function *optional
//  name: String *optional
// }
Migrations.add = function(migration) {
  if (typeof migration.up !== 'function')
    throw new Meteor.Error('Migration must supply an up function.');

  if (typeof migration.version !== 'number')
    throw new Meteor.Error('Migration must supply a version number.');

  if (migration.version <= 0)
    throw new Meteor.Error('Migration version must be greater than 0');

  // Freeze the migration object to make it hereafter immutable
  Object.freeze(migration);

  this._list.push(migration);
  this._list = _.sortBy(this._list, function(m) {
    return m.version;
  });
};

// Attempts to run the migrations using command in the form of:
// e.g 'latest', 'latest,exit', 2
// use 'XX,rerun' to re-run the migration at that version
Migrations.migrateTo = function(command) {
  if (_.isUndefined(command) || command === '' || this._list.length === 0)
    throw new Error('Cannot migrate using invalid command: ' + command);

  if (typeof command === 'number') {
    var version = command;
  } else {
    var version = command.split(',')[0]; //.trim();
    var subcommand = command.split(',')[1]; //.trim();
  }

  if (version === 'latest') {
    this._migrateTo(_.last(this._list).version);
  } else {
    this._migrateTo(parseInt(version), subcommand === 'rerun');
  }

  // remember to run meteor with --once otherwise it will restart
  if (subcommand === 'exit') process.exit(0);
};

// just returns the current version
Migrations.getVersion = function() {
  return this._getControl().version;
};

// migrates to the specific version passed in
Migrations._migrateTo = function(version, rerun) {
  var self = this;
  var control = this._getControl(); // Side effect: upserts control document.
  var currentVersion = control.version;

  if (lock() === false) {
    log.info('Not migrating, control is locked.');
    return;
  }

  if (rerun) {
    log.info('Rerunning version ' + version);
    migrate('up', this._findIndexByVersion(version));
    log.info('Finished migrating.');
    unlock();
    return;
  }

  if (currentVersion === version) {
    if (Migrations.options.logIfLatest) {
      log.info('Not migrating, already at version ' + version);
    }
    unlock();
    return;
  }

  var startIdx = this._findIndexByVersion(currentVersion);
  var endIdx = this._findIndexByVersion(version);

  // log.info('startIdx:' + startIdx + ' endIdx:' + endIdx);
  log.info(
    'Migrating from version ' +
      this._list[startIdx].version +
      ' -> ' +
      this._list[endIdx].version,
  );

  // run the actual migration
  function migrate(direction, idx) {
    var migration = self._list[idx];

    if (typeof migration[direction] !== 'function') {
      unlock();
      throw new Meteor.Error(
        'Cannot migrate ' + direction + ' on version ' + migration.version,
      );
    }

    function maybeName() {
      return migration.name ? ' (' + migration.name + ')' : '';
    }

    log.info(
      'Running ' +
        direction +
        '() on version ' +
        migration.version +
        maybeName(),
    );

    migration[direction](migration);
  }

  // Returns true if lock was acquired.
  function lock() {
    // This is atomic. The selector ensures only one caller at a time will see
    // the unlocked control, and locking occurs in the same update's modifier.
    // All other simultaneous callers will get false back from the update.
    return (
      self._collection.update(
        { _id: 'control', locked: false },
        { $set: { locked: true, lockedAt: new Date() } },
      ) === 1
    );
  }

  // Side effect: saves version.
  function unlock() {
    self._setControl({ locked: false, version: currentVersion });
  }

  if (currentVersion < version) {
    for (var i = startIdx; i < endIdx; i++) {
      migrate('up', i + 1);
      currentVersion = self._list[i + 1].version;
    }
  } else {
    for (var i = startIdx; i > endIdx; i--) {
      migrate('down', i);
      currentVersion = self._list[i - 1].version;
    }
  }

  unlock();
  log.info('Finished migrating.');
};

// gets the current control record, optionally creating it if non-existant
Migrations._getControl = function() {
  var control = this._collection.findOne({ _id: 'control' });

  return control || this._setControl({ version: 0, locked: false });
};

// sets the control record
Migrations._setControl = function(control) {
  // be quite strict
  check(control.version, Number);
  check(control.locked, Boolean);

  this._collection.update(
    { _id: 'control' },
    { $set: { version: control.version, locked: control.locked } },
    { upsert: true },
  );

  return control;
};

// returns the migration index in _list or throws if not found
Migrations._findIndexByVersion = function(version) {
  for (var i = 0; i < this._list.length; i++) {
    if (this._list[i].version === version) return i;
  }

  throw new Meteor.Error("Can't find migration version " + version);
};

//reset (mainly intended for tests)
Migrations._reset = function() {
  this._list = [{ version: 0, up: function() {} }];
  this._collection.remove({});
};

// unlock control
Migrations.unlock = function() {
  this._collection.update({ _id: 'control' }, { $set: { locked: false } });
};
