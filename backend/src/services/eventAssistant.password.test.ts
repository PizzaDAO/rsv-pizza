/**
 * party-password-hash: the event assistant never sees the password (or its hash). The model
 * gets `has_password`, and a proposed password change renders as (set)/(none).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({ party: { findUnique: vi.fn() } }));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const create = vi.hoisted(() => vi.fn());
vi.mock('../lib/openai.js', () => ({ getOpenAI: () => ({ chat: { completions: { create } } }) }));
vi.mock('../lib/privateConfig.js', () => ({ getLlmModels: async () => ({ assistant: 'test-model' }) }));

import { runEventAssistant } from './eventAssistant.service.js';
import { diffPatch, fmtSecret } from '../lib/eventEditSchema.js';

const HASH = '$2b$10$abcdefghijklmnopqrstuuSKk8d1yRq2bK3o3nUo0wq3n0f1y3Hk.';

function toolResponse(changes: unknown) {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: 'function',
          function: { name: 'propose_event_changes', arguments: JSON.stringify({ assistant_message: 'ok', changes }) },
        }],
      },
    }],
    usage: {},
  };
}

beforeEach(() => vi.clearAllMocks());

describe('event assistant password handling', () => {
  it('fmtSecret renders (set)/(none) and never the value', () => {
    expect(fmtSecret('hunter2')).toBe('(set)');
    expect(fmtSecret(true)).toBe('(set)');
    expect(fmtSecret(null)).toBe('(none)');
    expect(fmtSecret('')).toBe('(none)');
    const [c] = diffPatch({ password: true }, { password: 'hunter2' }, 'host');
    expect(c.currentDisplay).toBe('(set)');
    expect(c.proposedDisplay).toBe('(set)');
  });

  it('sends has_password to the model, never the stored hash; renders the diff as (set)/(none)', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ id: 'p1', name: 'Pie', timezone: 'UTC', password: HASH });
    create.mockResolvedValue(toolResponse({ password: null }));

    const result = await runEventAssistant({ partyId: 'p1', instruction: 'remove the password', role: 'host' } as any);

    const prompt = JSON.stringify(create.mock.calls[0][0].messages);
    expect(prompt).not.toContain(HASH);
    expect(prompt).toContain('has_password');

    const pw = result.proposedChanges.find((c) => c.key === 'password');
    expect(pw).toBeDefined();
    expect(pw!.currentDisplay).toBe('(set)');
    expect(pw!.proposedDisplay).toBe('(none)');
    expect(JSON.stringify(result)).not.toContain(HASH);
  });
});
