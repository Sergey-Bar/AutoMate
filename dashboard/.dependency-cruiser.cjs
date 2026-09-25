module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-orphans',
      severity: 'info',
      from: { orphan: true, pathNot: '\\.d\\.ts$' },
      to: {}
    }
  ],
  options: {
    tsPreCompilationDeps: false
  }
};
