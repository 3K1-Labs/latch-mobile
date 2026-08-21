/**
 * Both fixtures are real testnet simulation failures, captured while testing
 * delegated guardians against CAUSIP3BETIRVFUGN6DKE4ZDLWYVOUMQBZCVR4K2EXVSQDERLVP5FE4G.
 * Their outer line is identical; only the event log tells them apart, which is
 * the whole reason this parser exists.
 */
import { explainSorobanError, parseSorobanError } from '@/src/services/soroban-error';

const ACCOUNT = 'CAUSIP3BETIRVFUGN6DKE4ZDLWYVOUMQBZCVR4K2EXVSQDERLVP5FE4G';
const GUARDIAN = 'CBZ7MGUVRP5WUJ3V6EC7AM3VSCNKEQZOS3MX3TZTRXGFPAMJMP7UX5N5';
const POLICY = 'CAOCYSLYOURJIQY2IC4AUI6FVYZEUH2G6MFHXRZHIMVVGDDD74F7AFQO';

// A delegated guardian whose own account rejected the nested signature.
const GUARDIAN_REJECTED = `HostError: Error(Auth, InvalidAction)

Event log (newest first):
   0: [Diagnostic Event] contract:${ACCOUNT}, topics:[error, Error(Auth, InvalidAction)], data:"escalating error to VM trap from failed host function call: require_auth"
   1: [Diagnostic Event] contract:${ACCOUNT}, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", ${ACCOUNT}, Error(Auth, InvalidAction)]
   2: [Failed Diagnostic Event (not emitted)] contract:${ACCOUNT}, topics:[log], data:["VM call trapped with HostError", __check_auth, Error(Auth, InvalidAction)]
   3: [Failed Diagnostic Event (not emitted)] contract:${ACCOUNT}, topics:[error, Error(Auth, InvalidAction)], data:"escalating error to VM trap from failed host function call: require_auth_for_args"
   4: [Failed Diagnostic Event (not emitted)] contract:${ACCOUNT}, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", ${GUARDIAN}, Error(Contract, #3002)]
   5: [Failed Diagnostic Event (not emitted)] contract:${GUARDIAN}, topics:[log], data:["VM call trapped with HostError", __check_auth, Error(Contract, #3002)]
   6: [Failed Diagnostic Event (not emitted)] contract:${GUARDIAN}, topics:[error, Error(Contract, #3002)], data:"escalating error to VM trap from failed host function call: fail_with_error"
   7: [Failed Diagnostic Event (not emitted)] contract:${GUARDIAN}, topics:[error, Error(Contract, #3002)], data:["failing with contract error", 3002]`;

// A finalize whose args did not match the recorded proposal.
const PROPOSAL_MISMATCH = `HostError: Error(Auth, InvalidAction)

Event log (newest first):
   0: [Diagnostic Event] contract:${ACCOUNT}, topics:[error, Error(Auth, InvalidAction)], data:"escalating error to VM trap from failed host function call: require_auth"
   1: [Diagnostic Event] contract:${ACCOUNT}, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", ${ACCOUNT}, Error(Contract, #8)]
   2: [Failed Diagnostic Event (not emitted)] contract:${ACCOUNT}, topics:[log], data:["VM call trapped with HostError", __check_auth, Error(Contract, #8)]
   3: [Failed Diagnostic Event (not emitted)] contract:${POLICY}, topics:[log], data:["VM call trapped with HostError", enforce, Error(Contract, #8)]
   4: [Failed Diagnostic Event (not emitted)] contract:${POLICY}, topics:[error, Error(Contract, #8)], data:["failing with contract error", 8]`;

describe('parseSorobanError', () => {
  it('reads the innermost failure, not the outer Auth wrapper', () => {
    expect(parseSorobanError(GUARDIAN_REJECTED)).toMatchObject({
      code: 3002,
      contract: GUARDIAN,
    });
  });

  it('attributes a policy rejection to the policy contract', () => {
    expect(parseSorobanError(PROPOSAL_MISMATCH)).toMatchObject({
      code: 8,
      contract: POLICY,
    });
  });

  it('keeps the headline when there is no event log', () => {
    expect(parseSorobanError('HostError: Error(Storage, MissingValue)')).toEqual({
      code: null,
      contract: null,
      headline: 'HostError: Error(Storage, MissingValue)',
    });
  });
});

describe('explainSorobanError', () => {
  it('distinguishes two failures that share an outer message', () => {
    const a = explainSorobanError(GUARDIAN_REJECTED);
    const b = explainSorobanError(PROPOSAL_MISMATCH);
    expect(a).not.toEqual(b);
    expect(a).toContain('#3002');
    expect(b).toContain('#8');
  });

  it('still reports an unmapped code rather than hiding it', () => {
    expect(explainSorobanError('x\n data:["failing with contract error", 99] Error(Contract, #99)')).toContain(
      '#99',
    );
  });
});
