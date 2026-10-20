// The code under test for node-sample-suite.mjs. Two functions, one of which the suite
// never calls, so the lcov fixture has an uncovered function and uncovered lines.
export function add(left, right) {
  return left + right;
}

export function neverCalled(value) {
  if (value > 10) {
    return 'big';
  }
  return 'small';
}
