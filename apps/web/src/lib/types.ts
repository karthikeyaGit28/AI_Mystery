import type {
  CasePublicResponse,
  CaseStatusResponse,
  Difficulty,
  EvidencePublic,
  EvidenceType,
  HintPublicResponse,
  PlayerProgressPublic,
  SuspectPublic,
  VerdictResponse,
} from '@amr/shared';
export type { Difficulty, EvidenceType };
export type Suspect = SuspectPublic;
export type Evidence = EvidencePublic;
export type Progress = PlayerProgressPublic;
export type CaseData = CasePublicResponse;
export type CaseStatus = CaseStatusResponse;
export type Hint = Pick<HintPublicResponse, 'hintNumber' | 'text'> &
  Partial<Pick<HintPublicResponse, 'hintsRemaining'>>;
export type Verdict = VerdictResponse;
export interface HistoryCase {
  id: string;
  caseId?: string;
  title: string;
  difficulty: Difficulty;
  status: string;
  createdAt: string;
  submitted?: boolean;
  isSubmitted?: boolean;
  canRetry?: boolean;
}
