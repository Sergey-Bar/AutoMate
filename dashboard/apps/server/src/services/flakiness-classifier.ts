export type FlakinessCategory =
  | 'timing'
  | 'environment'
  | 'data'
  | 'assertion_drift'
  | 'unknown';

export interface ClassifyInput {
  testTitle: string;
  errorMessages: string[];
}

export interface FlakinessClassification {
  category: FlakinessCategory;
  confidence: number;
  evidence: string[];
}

// Each pattern entry has a category, keyword list (checked case-insensitively)
// and optional extra regexes for patterns that can't be expressed as plain keywords.
// When a keyword matches, the keyword itself (original casing from this list)
// is stored in evidence — making evidence meaningful and deduplicate-friendly.

const KEYWORD_PATTERNS: Array<{
  category: FlakinessCategory;
  keywords: string[];
  extraPatterns?: Array<{ regex: RegExp; evidenceLabel: string }>;
}> = [
  {
    category: 'timing',
    keywords: ['timeout', 'timed out', 'race condition', 'race', 'parallel', 'Worker'],
  },
  {
    category: 'environment',
    keywords: [
      'ECONNREFUSED',
      'ENOTFOUND',
      'EADDRINUSE',
      'network',
      'DNS',
      'ERR_CONNECTION',
      'socket hang up',
    ],
  },
  {
    category: 'data',
    keywords: ['unique constraint', 'duplicate key', 'not found', 'stale', 'expired', 'NULL'],
  },
  {
    category: 'assertion_drift',
    keywords: [],
    extraPatterns: [
      {
        regex: /expected\s+[\d.]+.*(?:got|received|actual)\s+[\d.]+/i,
        evidenceLabel: 'numeric assertion drift',
      },
      {
        regex: /[\d.]+\s+to\s+(?:be|equal)\s+[\d.]+/i,
        evidenceLabel: 'numeric assertion drift',
      },
    ],
  },
];

export function classifyFlakiness(input: ClassifyInput): FlakinessClassification {
  const { errorMessages } = input;

  if (errorMessages.length === 0) {
    return { category: 'unknown', confidence: 0.3, evidence: [] };
  }

  // Track match counts and evidence (deduplicated) per category
  const counts = new Map<FlakinessCategory, number>();
  const evidenceSets = new Map<FlakinessCategory, Set<string>>();

  for (const msg of errorMessages) {
    const msgLower = msg.toLowerCase();

    for (const { category, keywords, extraPatterns } of KEYWORD_PATTERNS) {
      let matched = false;

      // Check keywords case-insensitively; add original keyword to evidence
      for (const kw of keywords) {
        if (msgLower.includes(kw.toLowerCase())) {
          matched = true;
          const set = evidenceSets.get(category) ?? new Set<string>();
          set.add(kw);
          evidenceSets.set(category, set);
        }
      }

      // Check extra regex patterns
      if (extraPatterns) {
        for (const { regex, evidenceLabel } of extraPatterns) {
          if (regex.test(msg)) {
            matched = true;
            const set = evidenceSets.get(category) ?? new Set<string>();
            set.add(evidenceLabel);
            evidenceSets.set(category, set);
          }
        }
      }

      if (matched) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
  }

  if (counts.size === 0) {
    return { category: 'unknown', confidence: 0.3, evidence: [] };
  }

  // Priority order for tie-breaking: timing > environment > data > assertion_drift
  const priority: FlakinessCategory[] = ['timing', 'environment', 'data', 'assertion_drift'];
  let bestCategory: FlakinessCategory = 'unknown';
  let bestCount = 0;

  for (const cat of priority) {
    const count = counts.get(cat) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestCategory = cat;
    }
  }

  const confidence = Math.min(bestCount / errorMessages.length, 0.9);
  const evidence = Array.from(evidenceSets.get(bestCategory) ?? []);

  return { category: bestCategory, confidence, evidence };
}
