import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ImpactedTest {
  testFile: string;
  title: string;
  reason: string;
}

interface DependencyGraph {
  [filePath: string]: Set<string>; // Maps file -> files that import it
}

/**
 * Parse ES import statements from a file
 * Handles: import x from 'y', import { a } from 'b', import 'c'
 */
function extractImports(fileContent: string, filePath: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
  
  let match;
  while ((match = importRegex.exec(fileContent)) !== null) {
    const importPath = match[1];
    if (importPath == null) continue;
    
    // Skip node_modules and absolute imports
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      continue;
    }
    
    // Resolve relative path
    const dir = path.dirname(filePath);
    let resolved = path.resolve(dir, importPath);
    
    // Try to resolve with extensions if not present
    if (!fs.existsSync(resolved)) {
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];
      let found = false;
      
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) {
          resolved = withExt;
          found = true;
          break;
        }
      }
      
      // Try index file
      if (!found) {
        for (const ext of extensions) {
          const indexPath = path.join(resolved, `index${ext}`);
          if (fs.existsSync(indexPath)) {
            resolved = indexPath;
            found = true;
            break;
          }
        }
      }
      
      if (!found) {
        continue; // Skip unresolvable imports
      }
    } else if (fs.statSync(resolved).isDirectory()) {
      // If it's a directory, try index files
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];
      let found = false;
      for (const ext of extensions) {
        const indexPath = path.join(resolved, `index${ext}`);
        if (fs.existsSync(indexPath)) {
          resolved = indexPath;
          found = true;
          break;
        }
      }
      if (!found) continue;
    }
    
    // Normalize path
    resolved = path.normalize(resolved);
    imports.push(resolved);
  }
  
  return imports;
}

/**
 * Build a reverse dependency graph: source file -> which test files depend on it
 */
function buildDependencyGraph(testFiles: string[]): DependencyGraph {
  const graph: DependencyGraph = {};
  const visited = new Set<string>();
  
  function processFile(filePath: string, testFile: string) {
    if (visited.has(`${filePath}:${testFile}`)) return; // Prevent cycles
    visited.add(`${filePath}:${testFile}`);
    
    if (!fs.existsSync(filePath)) return;
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports = extractImports(content, filePath);
      
      for (const importedFile of imports) {
        // Add reverse dependency: importedFile -> testFile
        if (!graph[importedFile]) {
          graph[importedFile] = new Set();
        }
        graph[importedFile].add(testFile);
        
        // Recursively process dependencies
        processFile(importedFile, testFile);
      }
    } catch (err) {
      // Skip files that can't be read
    }
  }
  
  // Process each test file
  for (const testFile of testFiles) {
    processFile(testFile, testFile);
  }
  
  return graph;
}

/**
 * Find all test files in the workspace
 */
function findTestFiles(workspaceRoot: string): string[] {
  const testFiles: string[] = [];
  const testPattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
  
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip node_modules, dist, build directories
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
          continue;
        }
        
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && testPattern.test(entry.name)) {
          testFiles.push(path.normalize(fullPath));
        }
      }
    } catch (err) {
      // Skip directories that can't be read
    }
  }
  
  walk(workspaceRoot);
  return testFiles;
}

/**
 * Get the workspace root (monorepo root)
 */
function getWorkspaceRoot(): string {
  // Start from server directory and go up to find workspace root
  let current = path.resolve(__dirname, '../../..');
  
  // Look for pnpm-workspace.yaml or package.json with workspaces
  while (current !== path.parse(current).root) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(current, 'package.json'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  
  // Fallback to three levels up from server
  return path.resolve(__dirname, '../../..');
}

/**
 * Build a dependency chain description
 */
function buildReasonChain(changedFile: string, testFile: string, graph: DependencyGraph): string {
  if (changedFile === testFile) {
    return 'Direct test file change';
  }
  
  // Simple BFS to find path
  const queue: Array<{ file: string; path: string[] }> = [{ file: changedFile, path: [changedFile] }];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const { file, path: currentPath } = queue.shift()!;
    
    if (visited.has(file)) continue;
    visited.add(file);
    
    const dependents = graph[file] || new Set();
    
    if (dependents.has(testFile)) {
      // Found path to test file
      const chain = [...currentPath.map(f => path.basename(f)), path.basename(testFile)];
      if (chain.length === 2) {
        return `Imports ${chain[0]}`;
      }
      return `Imports ${chain[0]} via ${chain.slice(1, -1).join(' → ')}`;
    }
    
    // Continue BFS
    for (const dependent of dependents) {
      if (!visited.has(dependent)) {
        queue.push({ file: dependent, path: [...currentPath, dependent] });
      }
    }
  }
  
  return 'Dependency detected';
}

/**
 * Extract test title from test file
 */
function extractTestTitle(testFilePath: string): string {
  try {
    const content = fs.readFileSync(testFilePath, 'utf-8');
    
    // Try to find describe block
    const describeMatch = content.match(/describe\(['"`]([^'"`]+)['"`]/);
    if (describeMatch) {
      return describeMatch[1] ?? path.basename(testFilePath, path.extname(testFilePath));
    }
    
    // Try to find test/it block
    const testMatch = content.match(/(?:test|it)\(['"`]([^'"`]+)['"`]/);
    if (testMatch) {
      return testMatch[1] ?? path.basename(testFilePath, path.extname(testFilePath));
    }
    
    // Fallback to filename
    return path.basename(testFilePath, path.extname(testFilePath));
  } catch {
    return path.basename(testFilePath, path.extname(testFilePath));
  }
}

/**
 * Analyze impact of changed files and return affected test files
 */
export async function analyzeImpact(changedFiles: string[]): Promise<ImpactedTest[]> {
  const workspaceRoot = getWorkspaceRoot();
  
  // Find all test files
  const testFiles = findTestFiles(workspaceRoot);
  
  if (testFiles.length === 0) {
    return [];
  }
  
  // Build dependency graph
  const graph = buildDependencyGraph(testFiles);
  
  // Normalize changed file paths
  const normalizedChangedFiles = changedFiles.map(f => {
    const abs = path.isAbsolute(f) ? f : path.resolve(workspaceRoot, f);
    return path.normalize(abs);
  });
  
  // Find impacted tests
  const impactedTests = new Map<string, string>(); // testFile -> reason
  
  for (const changedFile of normalizedChangedFiles) {
    // Check if the changed file itself is a test
    if (testFiles.includes(changedFile)) {
      impactedTests.set(changedFile, 'Direct test file change');
      continue;
    }
    
    // Find tests that depend on this changed file
    const dependentTests = graph[changedFile] || new Set();
    
    for (const testFile of dependentTests) {
      if (!impactedTests.has(testFile)) {
        const reason = buildReasonChain(changedFile, testFile, graph);
        impactedTests.set(testFile, reason);
      }
    }
  }
  
  // Convert to result format
  const results: ImpactedTest[] = [];
  
  for (const [testFile, reason] of impactedTests) {
    const title = extractTestTitle(testFile);
    const relativePath = path.relative(workspaceRoot, testFile);
    
    results.push({
      testFile: relativePath,
      title,
      reason,
    });
  }
  
  return results;
}

// Backward-compatible alias with explicit testDir parameter for callers that
// already supply a test root. testDir is currently unused by static analyzer.
export async function getImpactedTests(
  changedFiles: string[],
  testDir: string,
): Promise<ImpactedTest[]> {
  void testDir;
  return analyzeImpact(changedFiles);
}
