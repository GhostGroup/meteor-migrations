Package.describe({
  summary: 'Define and run db migrations.',
  version: '1.1.0',
  name: 'growone:migrations',
  git: 'https://github.com/GhostGroup/meteor-migrations.git',
});

Package.on_use(function(api) {
  api.versionsFrom('1.5');
  api.use(['ecmascript', 'ostrio:logger@2.0.4', 'ostrio:loggerconsole@2.0.2'], 'server');
  api.use(['underscore', 'check', 'mongo'], 'server');
  api.mainModule('src/server/index.js', 'server');
});

Package.on_test(function(api) {
  api.use(['ecmascript', 'modules']);
  api.use(['percolate:migrations', 'tinytest']);
  api.addFiles('tests/index.js', ['server']);
});
