export type BestPracticeArea = 'update-sets' | 'record-ops' | 'contracts' | 'coding-standards';
export type BestPracticeOperation = 'create' | 'update' | 'delete';

export interface BestPracticeCitation {
  title: string;
  path: string;
}

export interface BestPracticeEntry {
  id: string;
  area: BestPracticeArea;
  title: string;
  guidance: string;
  appliesTo: {
    tables?: string[];
    operations?: BestPracticeOperation[];
  };
  riskLevel: 'low' | 'medium' | 'high';
  citations?: BestPracticeCitation[];
}
