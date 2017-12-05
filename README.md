# growone:migrations

Forked from [percolate:migrations](https://github.com/percolatestudio/meteor-migrations)

[![Build Status](https://travis-ci.org/percolatestudio/meteor-migrations.svg?branch=master)](https://travis-ci.org/percolatestudio/meteor-migrations)

A simple migration system for [Meteor](http://meteor.com) supporting up/downwards migrations and command line usage. There is also [a fork available](https://github.com/emmanuelbuah/mgdb-migrator) for use outside of Meteor.

## Installation

Meteor Migrations can be installed through Meteor's package manager. Type:

``` sh
$ meteor add growone:migrations
```

## API

## Migrations.config(options)
### options
* `log <boolean>` log migration details to the console
* `logger <function>` **[optional]** a custom logging function (will default to Meteor's logging package)
* `collectionName <string>` **[optional]** the mongodb collection name to store migration data (default: "migrations")
``` javascript
Migrations.config({
  log: true,
  logger(data) {
    // custom logging code...
  },
  collectionName: 'migrations',
});
```

## Migrations.init()
Initializes the `Migrations` package. This will create the collection and initializes the `control` record.
``` javascript
Migrations.config({
  collectionName: 'migrations',
});
Migrations.init();
```

## Migrations.reset()
Removes all `migrations` and records from `config.collectionName`.

## Migrations.add(options)

### options
* `version <number>` an integer specifying the version number.
* `up <function>` the code to update the data schema to this version
* `down <function>` **[optional]** the code to revert the changes in this version
* `name <string>` **[optional]** a name/label that can be referenced to run a single migration
* `description <string>` **[optional]** a short description of the migration intent
* `dependencies <[number|string]>` **[optional]** an array of migration versions and/or names that must be run before this migration can run `up`. the order of dependencies will be determined automatically.

**note:** `dependencies` are only used for **migrations** `up` and not for **reversions** `down`

``` javascript
Migrations.add({
  version: 201711301444,  // date/time as yyyymmddhhmm for human readability
  name: "GO-6779", // JIRA issue number
  description: "Added lookup fields on product model for Rob's table", // simple description of the reason for this migration
  up() {
    // code to migrate schema up to this version
  },
  down() {
    // code to revert this schema migration
  },
  dependencies: [201710310000, "GO-1337", "GO-1234"], // migration versions/names that must be run before this one
});
```

## Migrations.migrateAll(force)
Run all migrations' `up` functions sorted by version.

### options
* `force <Boolean>` default **false** run the migrations even if we are already at the latest version


## Migrations.migrateTo(version|name, force)
Run all migrations' `up` functions up to and including the specified migration `version` or `name`. Specify a migration `version` or `name`.

### options
* `version <number> | name <String>` the migration version you want to migrate to **OR** the migration name you want to migrate to
* `force <Boolean>` default **false** force the migrations to run even if already at this version or later

``` javascript
Migrations.migrateTo('GO-1337');
```


## Migrations.migrateOne(version|name, force)
Run a single migration `version` or `name` (and its dependencies') `up` function.

### options
* `version <number> | name <String>` the migration version you want to run **OR** the migration name you want to run
* `force <Boolean>` default **false** force the migration (and dependencies) to run even if already at this version or later

``` javascript
Migrations.migrateOne('GO-1337');
```


## Migrations.revertAll(force)
Run all migrations' `down` functions reverse sorted by version.

### options
* `force <Boolean>` default **false** force the reversion to run even if already at `zero`


## Migrations.revertTo(version|name, force)
Run all migrations' `down` functions down to and including the specified migration `version` or `name`.

### options
* `version <number> | name <String>` the migration version number you want to revert to **OR** the migration name you want to revert to
* `force <Boolean> default **false** force the reversions to run to this version even if already at this version or lower

``` javascript
Migrations.revertTo('GO-1337');
```

## Migrations.revertOne(version|name, force)
Run a single migration `version` or `name` (but **not** its dependencies') `down` function.

### options
* `version <number> | name <String>` the migration version number you want to revert **OR** the migration name you want to revert
* `force <Boolean>` default **false** force the reversion even if already at this version or lower

``` javascript

Migrations.revertOne('GO-1337');
```

## Migrations.setCurrentVersion(migration)
Sets the current migration version for the schema.
``` javascript
Migrations.setCurrentVersion({
  version: 201711301444,
  name: "GO-6779",
  description: "Added lookup fields on product model for Rob's table",
  up() {
    // code to migrate schema up to this version
  },
  down() {
    // code to revert this schema migration
  },
  dependencies: [201710310000, "GO-1337", "GO-1234"], // migration versions/names that must be run before this one
});
```

## Migrations.getCurrentVersion()
Returns the current schema version information.
``` javascript
const current = Migrations.getCurrentVersion();
// returns =>
// {
//   migration: {
//     version: 201711301444,
//     name: "GO-6779",
//     description: "Added lookup fields on product model for Rob's table", // simple description of the reason for this migration
//     up() {
//       // code to migrate schema up to this version
//     },
//     down() {
//       // code to revert this schema migration
//     },
//     dependencies: [201710310000, "GO-1337", "GO-1234"], // migration versions/names that must be run before this one
//   },
//   version: 201711301444,
//   name: "GO-6779",
// }
```

## Migrations.exists(versionOrName)
Returns the migration based on `version` or `name`. Throws an exception if there is no matching migration.
``` javascript
const migration = Migrations.exists("GO-6779");
// return =>
// {
//   version: 201711301444,
//   name: "GO-6779",
//   description: "Added lookup fields on product model for Rob's table", // simple description of the reason for this migration
//   up() {
//     // code to migrate schema up to this version
//   },
//   down() {
//     // code to revert this schema migration
//   },
//   dependencies: [201710310000, "GO-1337", "GO-1234"], // migration versions/names that must be run before this one
// }
```

## Migrations.sortedMigrations(reverse)
Returns an array of migrations sorted by `version`.

### options
* `reverse <Boolean>` default **false** return the migrations array in reverse order (largest to smallest version)


## Migrations.isLocked()
Throw an exception if the control record is locked.

## Migrations.lock()
Locks the migration control record.

## Migrations.unlock()
Unlocks a locked migration control record.


## Logging

Migrations uses [ostrio:loggerconsole](https://github.com/VeliovGroup/Meteor-logger-console) package by default. If you want to use your
own logger (for sending to other consumers or similar) you can do so by
configuring the `logger` option.

Migrations expects a function as `logger`, and will pass arguments to it for
you to take action on.

``` javascript
Migrations.config({
  logger({ level, message, tag }) {
    // custom logging code
  },
});

Migrations.init();

Migrations.add({ name: 'Test Job', ... });

Migrations.migrateAll();
```

The object passed to `logger` above includes `level`, `message`, and `tag`.

- `level` will be one of `info`, `warn`, `error`, `debug`.
- `message` is something like `Finished migrating.`.
- `tag` will always be `"Migrations"` (handy for filtering).

### Custom collection name

By default, the collection name is **migrations**. There may be cases where this is inadequate such as using the same Mongo database for multiple Meteor applications that each have their own set of migrations that need to be run.

### Errors
1. `Not migrating, control is locked`

  Migrations set a lock when they are migrating, to prevent multiple instances of your clustered app from running migrations simultaneously. If your migrations throw an exception, you will need to manually remove the lock (and ensure your db is still consistent) before re-running the migration.

  From the mongo shell update the migrations collection like this:

  ```
  $ meteor mongo

  db.migrations.update({_id:"control"}, {$set:{"locked":false}});
  exit
  ```

  Alternatively you can unlock the collection from either server code or the meteor shell using:

  ```
  Migrations.unlock();
  ```

## Contributing

1. Write some code.
2. Write some tests.
3. From this package's local directory, start the test runner:

    ```
    $ meteor test-packages ./
    ```

4. Open http://localhost:3000/ in your browser to see the test results.


## License

MIT. (c) Percolate Studio, maintained by Zoltan Olah (@zol).

Meteor Migrations was developed as part of the [Verso](http://versoapp.com) project.
