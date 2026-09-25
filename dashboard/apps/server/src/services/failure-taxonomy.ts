export type FailureCategory =
  | 'infra_issue'
  | 'env_issue'
  | 'test_debt'
  | 'flaky'
  | 'app_bug'
  | 'unknown';

export const CATEGORY_PRECEDENCE: FailureCategory[] = [
  'infra_issue',
  'env_issue',
  'test_debt',
  'flaky',
  'app_bug',
  'unknown',
];

export type TaxonomyRuleMatchType = 'contains' | 'regex' | 'exact';
export type TaxonomyRuleField =
  | 'error_message'
  | 'error_stack'
  | 'test_name'
  | 'test_title'
  | 'file_path';

export interface TaxonomyRule {
  id: string;
  category: FailureCategory;
  matchType: TaxonomyRuleMatchType;
  pattern: string;
  field: TaxonomyRuleField;
  priority: number;
  enabled: boolean;
}

export interface ClassificationResult {
  category: FailureCategory;
  confidence: number;
  matchedRuleId: string | null;
  evidence: string;
}

export interface FailureInput {
  resultId: string;
  errorMessage: string | null;
  errorStack: string | null;
  testName: string;
  runId: string;
  filePath?: string | null;
  manualCategory?: FailureCategory | null;
  isManualOverride?: boolean;
}

export interface FailureClassificationRecord {
  resultId: string;
  runId: string;
  category: FailureCategory;
  confidence: number;
  matchedRuleId: string | null;
  evidence: string;
  classifiedAt: string;
}

const BUILTIN_RULES: Array<{ category: Exclude<FailureCategory, 'unknown'>; patterns: RegExp[] }> = [
  {
    category: 'infra_issue',
    patterns: [
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /socket hang up/i,
      /network error/i,
      /dns resolution/i,
      /connection reset/i,
      /EPERM/i,
      /EACCES/i,
      /out of memory/i,
      /OOMKilled/i,
      /disk full/i,
      /no space left/i,
    ],
  },
  {
    category: 'env_issue',
    patterns: [
      /missing env/i,
      /environment variable/i,
      /config not found/i,
      /invalid configuration/i,
      /port .* in use/i,
      /EADDRINUSE/i,
      /certificate/i,
      /SSL/i,
      /permission denied/i,
    ],
  },
  {
    category: 'test_debt',
    patterns: [
      /deprecated/i,
      /fixme/i,
      /todo/i,
      /skip.*reason/i,
      /pending implementation/i,
      /not implemented/i,
      /hardcoded/i,
    ],
  },
  {
    category: 'flaky',
    patterns: [
      /timeout/i,
      /timed out/i,
      /intermittent/i,
      /race condition/i,
      /flak/i,
      /retry/i,
      /eventually/i,
      /waitFor.*timeout/i,
      /polling.*exceeded/i,
    ],
  },
  {
    category: 'app_bug',
    patterns: [
      /expect.*to(Be|Equal|Match|Have|Contain|Throw)/i,
      /AssertionError/i,
      /assertion failed/i,
      /expected.*but.*received/i,
      /toBe/i,
      /toEqual/i,
    ],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function valuesForBuiltins(input: FailureInput): string[] {
  return [input.errorMessage, input.errorStack, input.testName, input.filePath]
    .filter((entry): entry is string => Boolean(entry && entry.trim().length > 0));
}

function valueForRuleField(input: FailureInput, field: TaxonomyRuleField): string {
  switch (field) {
    case 'error_message':
      return input.errorMessage ?? '';
    case 'error_stack':
      return input.errorStack ?? '';
    case 'test_name':
    case 'test_title':
      return input.testName ?? '';
    case 'file_path':
      return input.filePath ?? '';
    default:
      return '';
  }
}

function evaluateRule(input: FailureInput, rule: TaxonomyRule): ClassificationResult | null {
  if (!rule.enabled) {
    return null;
  }

  const target = valueForRuleField(input, rule.field);
  if (!target) {
    return null;
  }

  const normTarget = normalize(target);
  const normPattern = normalize(rule.pattern);

  if (rule.matchType === 'exact' && normTarget === normPattern) {
    return {
      category: rule.category,
      confidence: 1,
      matchedRuleId: rule.id,
      evidence: `Matched DB exact rule '${rule.id}' on ${rule.field}: '${rule.pattern}'`,
    };
  }

  if (rule.matchType === 'contains' && normTarget.includes(normPattern)) {
    return {
      category: rule.category,
      confidence: 0.9,
      matchedRuleId: rule.id,
      evidence: `Matched DB contains rule '${rule.id}' on ${rule.field}: '${rule.pattern}'`,
    };
  }

  if (rule.matchType === 'regex') {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(target)) {
        return {
          category: rule.category,
          confidence: 0.9,
          matchedRuleId: rule.id,
          evidence: `Matched DB regex rule '${rule.id}' on ${rule.field}: /${rule.pattern}/i`,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function classifyWithBuiltins(input: FailureInput): ClassificationResult {
  const values = valuesForBuiltins(input);

  for (const category of CATEGORY_PRECEDENCE) {
    if (category === 'unknown') {
      continue;
    }

    const ruleGroup = BUILTIN_RULES.find((entry) => entry.category === category);
    if (!ruleGroup) {
      continue;
    }

    const matchedPatterns = new Set<string>();
    for (const pattern of ruleGroup.patterns) {
      for (const value of values) {
        if (pattern.test(value)) {
          matchedPatterns.add(pattern.source);
          break;
        }
      }
    }

    if (matchedPatterns.size > 0) {
      const confidence = matchedPatterns.size > 1 ? 0.85 : 0.8;
      const matched = [...matchedPatterns].join(', ');
      return {
        category,
        confidence,
        matchedRuleId: null,
        evidence: `Matched builtin ${category} pattern(s): ${matched}`,
      };
    }
  }

  return {
    category: 'unknown',
    confidence: 0,
    matchedRuleId: null,
    evidence: 'No DB or builtin taxonomy rules matched',
  };
}

export function classifyFailure(input: FailureInput, dbRules: TaxonomyRule[] = []): ClassificationResult {
  if (input.isManualOverride && input.manualCategory) {
    return {
      category: input.manualCategory,
      confidence: 1,
      matchedRuleId: null,
      evidence: `Manual override preserved for category '${input.manualCategory}'`,
    };
  }

  const enabledRules = dbRules
    .filter((rule) => rule.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const rule of enabledRules) {
    const match = evaluateRule(input, rule);
    if (match) {
      return match;
    }
  }

  return classifyWithBuiltins(input);
}

export function classifyFailures(inputs: FailureInput[], dbRules: TaxonomyRule[] = []): ClassificationResult[] {
  return inputs.map((input) => classifyFailure(input, dbRules));
}

export function toFailureClassificationRecord(
  input: FailureInput,
  classification: ClassificationResult,
): FailureClassificationRecord {
  return {
    resultId: input.resultId,
    runId: input.runId,
    category: classification.category,
    confidence: classification.confidence,
    matchedRuleId: classification.matchedRuleId,
    evidence: classification.evidence,
    classifiedAt: new Date().toISOString(),
  };
}
