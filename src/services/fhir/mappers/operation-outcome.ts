import type { FhirOperationOutcome, OperationOutcomeIssueCode } from '@services/fhir/fhir.types';

/** HTTP status -> the closest FHIR issue-type code. */
export function issueCodeForStatus(status: number): OperationOutcomeIssueCode {
  switch (status) {
    case 400:
    case 422:
      return 'invalid';
    case 401:
      return 'login';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 405:
    case 501:
      return 'not-supported';
    case 429:
      return 'throttled';
    default:
      return 'exception';
  }
}

export function buildOperationOutcome(status: number, diagnostics: string): FhirOperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: [
      {
        severity: status >= 500 ? 'fatal' : 'error',
        code: issueCodeForStatus(status),
        diagnostics,
      },
    ],
  };
}

/** Warning that a visit-derived result holds only the most recent `included` of `total` visits. */
export function buildTruncationOutcome(included: number, total: number): FhirOperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: [
      {
        severity: 'warning',
        code: 'incomplete',
        diagnostics: `Result is incomplete: ${included} of ${total} visits were included (most recent first).`,
      },
    ],
  };
}
