export type ExtractionCandidate = {
  fields: Array<{
    name: string;
    value: string;
    confidence: number;
    sourcePage?: number;
    sourceText?: string;
    warning?: string;
    ambiguity?: string;
  }>;
};

export interface TimetableExtractionProvider {
  extract(input: {
    fileUrl: string;
    mimeType: string;
    institutionId?: string;
  }): Promise<ExtractionCandidate>;
}
