import { Migrations } from '../src/server';

const collectionName = '_____migrations_tests_____';
Migrations.config({ collectionName });
Migrations.init();
Migrations.reset();

const today = Number(new Date()
                .toISOString()
                .slice(0, this.lastIndexOf(':'))
                .replace(/-/g, '')
                .replace(/T/, ''));
let run = [];
const reset = () => {
  Migrations.__nuke__();
  Migrations.init();
  Migrations.reset();
  run = [];
}

const migrationList = [{
  version: today,
  name: 'GO-1234',
  up() {
    run.push('u1');
  },
  down() {
    run.push('d1');
  },
}, {
  version: today + 2,
  name: 'GO-1235',
  up() {
    run.push('u2');
  },
  down() {
    run.push('d2');
  },
}, {
  version: today + 3,
  name: 'GO-1236',
  up() {
    run.push('u3');
  },
  down() {
    run.push('d3');
  },
}, {
  version: today + 4,
  name: 'GO-1237',
  up() {
    run.push('u4');
  },
  down() {
    run.push('d4');
  },
}];

Tinytest.add('Migrates up once and only once.', function(test) {
  const m = migrationList[0];
  Migrations.add({ ...m });

  Migrations.migrateTo('latest');

  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // shouldn't do anything
  Migrations.migrateTo('latest');
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  reset();
});

Tinytest.add('Migrates up once and back down.', function(test) {
  const m = migrationList[0];
  Migrations.add({ ...m });

  Migrations.migrateTo('latest');
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  Migrations.revertTo(0);
  test.equal(run, ['u1', 'd1']);
  test.equal(Migrations.getCurrentVersion().version, 0);

  reset();
});

Tinytest.add('Migrates up several times.', function(test) {
  const m = migrationList[0];
  Migrations.add({ ...m });

  // migrates once
  Migrations.migrateTo('latest');
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // add two more, out of order
  const m3 = migrationList[2];
  const m4 = migrationList[3];
  Migrations.add({ ...m4 });
  Migrations.add({ ...m3 });

  // should run the next two nicely in order
  Migrations.migrateTo('latest');
  test.equal(run, ['u1', 'u3', 'u4']);
  test.equal(Migrations.getCurrentVersion().version, m4.version);

  reset();
});

Tinytest.add('Tests migrating down', function(test) {
  const m1 = migrationList[0];
  const m2 = migrationList[1];
  const m3 = migrationList[2];

  Migrations.add({ ...m1 });
  Migrations.add({ ...m2 });
  Migrations.add({ ...m3 });

  // migrates up
  Migrations.migrateTo('latest');
  test.equal(run, ['u1', 'u2', 'u3']);
  test.equal(Migrations.getCurrentVersion().version, m3.version);

  // migrates down
  Migrations.revertTo(2);
  test.equal(run, ['u1', 'u2', 'u3', 'd3']);
  test.equal(Migrations.getCurrentVersion().version, m2.version);

  reset();
});

Tinytest.add('Tests migrating down to version 0', function(test) {
  test.equal(Migrations.getCurrentVersion().version, 0);

  const m = migrationList[0];
  Migrations.add({ ...m });

  // migrates up
  Migrations.migrateTo('latest');
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // migrates down
  Migrations.revertTo(0);
  test.equal(run, ['u1', 'd1']);
  test.equal(Migrations.getCurrentVersion().version, 0);

  reset();
});

Tinytest.add('Checks that locking works correctly', function(test) {
  const m = migrationList[0];
  Migrations.add({
    ...m,
    up() {
      run.push('u1');

      // attempts a migration from within the migration, this should have no
      // effect due to locking
      Migrations.migrateTo('latest');
    },
  });

  // migrates up, should only migrate once
  Migrations.migrateTo('latest');
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  reset();
});

Tinytest.add('Does nothing for no migrations.', function(test) {
  // shouldnt do anything
  Migrations.migrateTo('latest');
  test.equal(Migrations.getCurrentVersion().version, 0);
});

Tinytest.add('Checks that rerun works correctly', function(test) {
  const m = migrationList[0];
  Migrations.add({ ...m });

  Migrations.migrateTo('latest');
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // shouldn't migrate
  Migrations.migrateTo(m.version);
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // should migrate again
  Migrations.migrateTo(m.version, true);
  test.equal(run, ['u1', 'u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  reset();
});

Tinytest.add('Checks that rerun works by providing name', function(test) {
  const m = migrationList[0];
  Migrations.add({ ...m });

  Migrations.migrateTo(m.name);
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // shouldn't migrate
  Migrations.migrateTo(m.version);
  test.equal(run, ['u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  // should migrate again
  Migrations.migrateTo(m.version, true);
  test.equal(run, ['u1', 'u1']);
  test.equal(Migrations.getCurrentVersion().version, m.version);

  reset();
});
