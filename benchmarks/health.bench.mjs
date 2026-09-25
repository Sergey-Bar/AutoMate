import autocannon from 'autocannon';

const result = await autocannon({
  url: 'http://localhost:3000/health',
  duration: 5,
  connections: 10,
});

console.log(autocannon.printResult(result));
if (result.latency.p99 > 100) {
  console.error('p99 latency exceeds 100ms threshold');
  process.exit(1);
}
